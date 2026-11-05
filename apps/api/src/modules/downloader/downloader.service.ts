import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import type { Response } from 'express';
import ffmpegPath from 'ffmpeg-static';
import youtubeDl, { type Flags } from 'youtube-dl-exec';
import { cfg } from '../../config';

export const DOWNLOAD_QUALITIES = ['best', '1080', '720', '480', '360'] as const;
export type DownloadQuality = (typeof DOWNLOAD_QUALITIES)[number];

export type DownloadRequest = {
  url?: unknown;
  quality?: unknown;
  audioOnly?: unknown;
};

type NormalizedRequest = {
  url: string;
  quality: DownloadQuality;
  audioOnly: boolean;
};

export type PreparedDownload = {
  filePath: string;
  filename: string;
  contentType: string;
  size: number;
  cleanup: () => Promise<void>;
};

const ALLOWED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'fb.com',
  'fb.watch',
  'bilibili.com',
  'b23.tv',
];

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.mov']);
const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
};

export function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((domain) => host === domain || host.endsWith('.' + domain));
}

function normalizeRequest(input: DownloadRequest): NormalizedRequest {
  const raw = typeof input.url === 'string' ? input.url.trim() : '';
  if (!raw || raw.length > 2048) {
    throw new BadRequestException('URL video wajib diisi (maksimal 2048 karakter).');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestException('URL video tidak valid.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('URL harus memakai http atau https.');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException('URL tidak boleh memuat kredensial.');
  }
  if (!isAllowedHost(parsed.hostname)) {
    throw new BadRequestException('Hanya tautan YouTube, Facebook, dan Bilibili yang didukung.');
  }

  const quality = (input.quality ?? 'best') as DownloadQuality;
  if (!DOWNLOAD_QUALITIES.includes(quality)) {
    throw new BadRequestException('Pilihan resolusi tidak dikenal.');
  }

  return { url: parsed.toString(), quality, audioOnly: input.audioOnly === true };
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '');
}

function ytDlpError(error: unknown): string {
  const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
  const lines = stripAnsi(stderr)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const line = [...lines].reverse().find((item) => /^ERROR:/i.test(item)) ?? lines.at(-1) ?? '';
  return line.replace(/^ERROR:\s*/i, '').slice(0, 300);
}

function contentDisposition(filename: string): string {
  // Header HTTP hanya ASCII; fallback aman + filename* UTF-8 (RFC 5987).
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

@Injectable()
export class DownloaderService implements OnModuleInit {
  private readonly logger = new Logger(DownloaderService.name);
  private readonly tempRoot = cfg.tempDir;

  async onModuleInit(): Promise<void> {
    await mkdir(this.tempRoot, { recursive: true }).catch(() => undefined);
    // Bersihkan sisa proses yang mati sebelum sempat menghapus folder temp.
    const entries = await readdir(this.tempRoot, { withFileTypes: true }).catch(() => []);
    const cutoff = Date.now() - 6 * 60 * 60_000;
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('download-'))
        .map(async (entry) => {
          const path = join(this.tempRoot, entry.name);
          const info = await stat(path).catch(() => null);
          if (info && info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true }).catch(() => undefined);
        }),
    );
  }

  async prepare(input: DownloadRequest, signal: AbortSignal): Promise<PreparedDownload> {
    const request = normalizeRequest(input);
    if (!ffmpegPath) {
      throw new ServiceUnavailableException('ffmpeg-static tidak tersedia. Jalankan pnpm install ulang.');
    }

    await mkdir(this.tempRoot, { recursive: true });
    const dir = await mkdtemp(join(this.tempRoot, 'download-'));
    const cleanup = async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    };

    try {
      const output = join(dir, '%(title).120B [%(id)s].%(ext)s');
      const common: Flags = {
        output,
        noPlaylist: true,
        noMtime: true,
        noPart: true,
        noProgress: true,
        noWarnings: true,
        newline: true,
        ignoreConfig: true,
        noCacheDir: true,
        ffmpegLocation: ffmpegPath,
        socketTimeout: 30,
        retries: 3,
        concurrentFragments: 4,
      };

      const flags: Flags = request.audioOnly
        ? {
            ...common,
            format: 'bestaudio/best',
            extractAudio: true,
            audioFormat: 'mp3',
            audioQuality: 0,
          }
        : {
            ...common,
            format:
              request.quality === 'best'
                ? 'bv*+ba/b'
                : 'bv*[height<=' + request.quality + ']+ba/b[height<=' + request.quality + ']',
            mergeOutputFormat: 'mp4',
            remuxVideo: 'mp4',
          };

      await youtubeDl.exec(request.url, flags, { cwd: dir, signal });

      const files = (await readdir(dir))
        .filter((name) => !name.startsWith('.') && !/\.(part|ytdl|temp)$/i.test(name))
        .map((name) => join(dir, name));
      const candidates = (
        await Promise.all(
          files.map(async (filePath) => {
            const info = await stat(filePath).catch(() => null);
            return info?.isFile() && info.size > 0 ? { filePath, size: info.size } : null;
          }),
        )
      ).filter((item): item is { filePath: string; size: number } => item !== null);

      const preferred = request.audioOnly ? '.mp3' : '.mp4';
      const chosen =
        candidates.find((item) => extname(item.filePath).toLowerCase() === preferred) ??
        candidates.find((item) => VIDEO_EXTENSIONS.has(extname(item.filePath).toLowerCase())) ??
        candidates[0];

      if (!chosen) throw new Error('yt-dlp tidak menghasilkan file.');

      const safePath = resolve(chosen.filePath);
      if (!safePath.startsWith(resolve(dir) + sep)) throw new Error('File hasil tidak valid.');

      const extension = extname(safePath).toLowerCase();
      return {
        filePath: safePath,
        filename: basename(safePath),
        contentType: MIME[extension] ?? 'application/octet-stream',
        size: chosen.size,
        cleanup,
      };
    } catch (error) {
      await cleanup();
      if (signal.aborted) throw new BadRequestException('Unduhan dibatalkan.');
      const detail = ytDlpError(error);
      if (detail) this.logger.warn('yt-dlp gagal: ' + detail);
      throw new BadRequestException(
        detail ? 'Gagal memproses video: ' + detail : 'Gagal memproses video. Pastikan tautan publik dan coba lagi.',
      );
    }
  }

  async send(prepared: PreparedDownload, res: Response): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', prepared.contentType);
    res.setHeader('Content-Length', String(prepared.size));
    res.setHeader('Content-Disposition', contentDisposition(prepared.filename));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    const stream = createReadStream(prepared.filePath);
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stream.destroy();
        void prepared.cleanup().then(resolve);
      };

      stream.on('error', () => {
        if (!res.headersSent) res.status(500).json({ message: 'Gagal membaca file hasil.' });
        else if (!res.writableEnded) res.end();
        finish();
      });
      res.on('finish', finish);
      res.on('close', finish);
      stream.pipe(res);
    });
  }
}
