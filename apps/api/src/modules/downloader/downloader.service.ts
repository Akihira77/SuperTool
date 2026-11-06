import { BadRequestException, Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
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

export type DownloadInfo = {
  url: string;
  id: string;
  title: string;
  uploader: string;
  duration: number | null;
  thumbnail: string | null;
  source: string;
  webpageUrl: string;
  heights: number[];
  hasAudio: boolean;
  live: boolean;
};

export type CookieStatus = {
  configured: boolean;
  size: number;
  mtime: number | null;
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

function ytDlpStderr(error: unknown): string {
  const stderr = typeof (error as { stderr?: unknown })?.stderr === 'string' ? (error as { stderr: string }).stderr : '';
  return stripAnsi(stderr);
}

function ytDlpError(error: unknown): string {
  const lines = ytDlpStderr(error)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const line = [...lines].reverse().find((item) => /^ERROR:/i.test(item)) ?? lines.at(-1) ?? '';
  return line.replace(/^ERROR:\s*/i, '').slice(0, 300);
}

/** Error yang biasanya muncul saat merge/remux ffmpeg, bukan saat ambil metadata. */
function isMergeError(error: unknown): boolean {
  const detail = ytDlpStderr(error) + '\n' + (error instanceof Error ? error.message : '');
  return /postprocessing:|Error opening input files|Invalid data found when processing input|Conversion failed/i.test(detail);
}

/** Facebook sering hanya menyediakan satu format progresif, tanpa stream video/audio terpisah. */
function isFormatUnavailable(error: unknown): boolean {
  const detail = ytDlpStderr(error) + '\n' + (error instanceof Error ? error.message : '');
  return /Requested format is not available|No video formats found|format is not available/i.test(detail);
}

function isBilibiliHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'b23.tv' || host === 'bilibili.com' || host.endsWith('.bilibili.com');
}

/** B23 share links sometimes redirect to /en/video/BV...; yt-dlp's BiliBili
 * extractor only recognizes the canonical /video/BV... path. */
export function canonicalBilibiliUrl(url: URL): string | null {
  if (!isBilibiliHost(url.hostname) || url.hostname.toLowerCase() === 'b23.tv') return null;
  const match = /^\/(?:[a-z]{2}(?:-[a-z]{2,})?\/)?video\/(BV[0-9A-Za-z]+|av\d+)/i.exec(url.pathname);
  if (!match) return null;
  const canonical = new URL('https://www.bilibili.com/video/' + match[1]);
  const page = url.searchParams.get('p');
  if (page && /^\d{1,4}$/.test(page)) canonical.searchParams.set('p', page);
  return canonical.toString();
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
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

  private get cookiesFile(): string {
    return join(cfg.dataDir, 'cookies.txt');
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.tempRoot, { recursive: true }).catch(() => undefined);
    const binary = (youtubeDl as unknown as { constants?: { YOUTUBE_DL_PATH?: string } }).constants?.YOUTUBE_DL_PATH;
    if (binary) {
      await new Promise<void>((resolve) => {
        execFile(binary, ['--version'], { timeout: 5000 }, (error, stdout) => {
          if (error) this.logger.warn('Tidak bisa membaca versi yt-dlp: ' + error.message);
          else this.logger.log('yt-dlp ' + stdout.trim());
          resolve();
        });
      });
    }
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

  async cookiesStatus(): Promise<CookieStatus> {
    const info = await stat(this.cookiesFile).catch(() => null);
    return info?.isFile()
      ? { configured: true, size: info.size, mtime: info.mtimeMs }
      : { configured: false, size: 0, mtime: null };
  }

  async saveCookies(buffer: Buffer): Promise<CookieStatus> {
    if (!buffer.length) throw new BadRequestException('File cookies.txt kosong.');
    if (buffer.length > 1_000_000) throw new BadRequestException('Ukuran cookies.txt maksimal 1 MB.');
    const raw = buffer.toString('utf8').replace(/^\uFEFF/, '');
    if (raw.includes('\u0000')) throw new BadRequestException('File cookies.txt bukan teks.');
    const valid = /^# (Netscape )?HTTP Cookie File/m.test(raw)
      || raw.split(/\r?\n/).some((line) => {
        const cookie = line.startsWith('#HttpOnly_') || !line.startsWith('#');
        return cookie && line.split('\t').length >= 7;
      });
    if (!valid) {
      throw new BadRequestException('Format cookies tidak valid. Ekspor cookies.txt (format Netscape) dari browser.');
    }
    await mkdir(cfg.dataDir, { recursive: true });
    await writeFile(this.cookiesFile, Buffer.from(raw), { mode: 0o600 });
    await chmod(this.cookiesFile, 0o600).catch(() => undefined);
    this.logger.log('cookies.txt diperbarui (' + raw.length + ' byte)');
    return this.cookiesStatus();
  }

  async clearCookies(): Promise<CookieStatus> {
    await rm(this.cookiesFile, { force: true });
    return this.cookiesStatus();
  }

  private async cookiesPath(): Promise<string | undefined> {
    const info = await stat(this.cookiesFile).catch(() => null);
    return info?.isFile() ? this.cookiesFile : undefined;
  }

  private logYtDlpFailure(error: unknown, context: string): void {
    const stderr = ytDlpStderr(error).trim();
    if (stderr) this.logger.error(context + '; stderr:\n' + stderr.slice(-12000));
  }

  /** Resolve b23.tv redirects to a canonical Bilibili video URL before yt-dlp. */
  private async resolveBilibiliUrl(raw: string, signal?: AbortSignal): Promise<string> {
    const parsed = new URL(raw);
    const direct = canonicalBilibiliUrl(parsed);
    if (direct) return direct;
    if (parsed.hostname.toLowerCase() !== 'b23.tv') return raw;

    let current = parsed;
    for (let hop = 0; hop < 5; hop += 1) {
      const canonical = canonicalBilibiliUrl(current);
      if (canonical) return canonical;
      let response;
      try {
        const timeout = AbortSignal.timeout(5000);
        response = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
            'accept-language': 'en-US,en;q=0.9',
            referer: 'https://www.bilibili.com/',
          },
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        return raw;
      }
      if (response.status < 300 || response.status >= 400) return raw;
      const location = response.headers.get('location');
      if (!location) return raw;
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return raw;
      }
      if (next.protocol !== 'https:' || !isBilibiliHost(next.hostname)) return raw;
      current = next;
    }
    return raw;
  }

  async prepare(input: DownloadRequest, signal: AbortSignal): Promise<PreparedDownload> {
    const request = normalizeRequest(input);
    const target = await this.resolveBilibiliUrl(request.url, signal);
    if (!ffmpegPath) {
      throw new ServiceUnavailableException('ffmpeg-static tidak tersedia. Jalankan pnpm install ulang.');
    }

    await mkdir(this.tempRoot, { recursive: true });
    const dir = await mkdtemp(join(this.tempRoot, 'download-'));
    const cleanup = async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    };

    const cookies = await this.cookiesPath();
    try {
      const common: Flags = {
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
        verbose: true,
        ...(cookies ? { cookies } : {}),
      };

      // Best mencoba 4K dulu. Kalau ffmpeg gagal merge, ulangi dengan format
      // gabungan <=1080 yang tidak perlu merge (Bug DASH Bilibili/HEVC).
      const formats = request.audioOnly
        ? ['bestaudio/best']
        : request.quality === 'best'
          ? ['bv*+ba/b', 'best[height<=1080]/best']
          : [
              'bv*[height<=' + request.quality + ']+ba/b[height<=' + request.quality + ']',
              'best[height<=' + request.quality + ']/best',
            ];

      let chosen: { filePath: string; size: number } | undefined;
      let lastError: unknown;

      for (let attempt = 0; attempt < formats.length; attempt += 1) {
        const attemptDir = join(dir, 'attempt-' + (attempt + 1));
        await mkdir(attemptDir, { recursive: true });
        const flags: Flags = request.audioOnly
          ? {
              ...common,
              output: join(attemptDir, '%(title).120B [%(id)s].%(ext)s'),
              format: formats[attempt],
              extractAudio: true,
              audioFormat: 'mp3',
              audioQuality: 0,
            }
          : {
              ...common,
              output: join(attemptDir, '%(title).120B [%(id)s].%(ext)s'),
              format: formats[attempt],
              mergeOutputFormat: 'mp4',
              remuxVideo: 'mp4',
            };

        try {
          await youtubeDl.exec(target, flags, { cwd: attemptDir, signal });
          const files = (await readdir(attemptDir))
            .filter((name) => !name.startsWith('.') && !/\.(part|ytdl|temp)$/i.test(name))
            .map((name) => join(attemptDir, name));
          const candidates = (
            await Promise.all(
              files.map(async (filePath) => {
                const info = await stat(filePath).catch(() => null);
                return info?.isFile() && info.size > 0 ? { filePath, size: info.size } : null;
              }),
            )
          ).filter((item): item is { filePath: string; size: number } => item !== null);

          const preferred = request.audioOnly ? '.mp3' : '.mp4';
          chosen =
            candidates.find((item) => extname(item.filePath).toLowerCase() === preferred) ??
            candidates.find((item) => VIDEO_EXTENSIONS.has(extname(item.filePath).toLowerCase())) ??
            candidates[0];
          if (!chosen) throw new Error('yt-dlp tidak menghasilkan file.');
          break;
        } catch (error) {
          lastError = error;
          if (signal.aborted) throw error;
          const noFile = error instanceof Error && /tidak menghasilkan file/i.test(error.message);
          const canFallback = !request.audioOnly && attempt < formats.length - 1 && (isMergeError(error) || isFormatUnavailable(error) || noFile);
          if (!canFallback) throw error;
          await rm(attemptDir, { recursive: true, force: true }).catch(() => undefined);
          this.logger.warn(
            'yt-dlp format ' + formats[attempt] + ' gagal; fallback ke ' + formats[attempt + 1] +
              (ytDlpError(error) ? ': ' + ytDlpError(error) : ''),
          );
        }
      }

      if (!chosen) throw lastError ?? new Error('yt-dlp tidak menghasilkan file.');

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
      this.logYtDlpFailure(error, 'yt-dlp gagal');
      const detail = ytDlpError(error);
      const host = new URL(request.url).hostname;
      const hint = isBilibiliHost(host) && !cookies
        ? ' Bilibili resolusi tinggi sering butuh cookies; unggah cookies.txt di Settings.'
        : '';
      throw new BadRequestException(
        detail ? 'Gagal memproses video: ' + detail + hint : 'Gagal memproses video. Pastikan tautan publik dan coba lagi.' + hint,
      );
    }
  }

  /** Metadata saja (--skip-download), untuk preview sebelum user memilih resolusi. */
  async info(input: DownloadRequest, signal?: AbortSignal): Promise<DownloadInfo> {
    const request = normalizeRequest(input);
    const target = await this.resolveBilibiliUrl(request.url, signal);
    const cookies = await this.cookiesPath();
    const flags: Flags = {
      dumpSingleJson: true,
      skipDownload: true,
      noPlaylist: true,
      noWarnings: true,
      ignoreConfig: true,
      noCacheDir: true,
      socketTimeout: 30,
      retries: 2,
      ...(cookies ? { cookies } : {}),
    };

    let parsed: unknown;
    try {
      parsed = await youtubeDl(target, flags, { signal });
    } catch (error) {
      if (signal?.aborted) throw new BadRequestException('Pengambilan info dibatalkan.');
      this.logYtDlpFailure(error, 'yt-dlp info gagal');
      const detail = ytDlpError(error);
      throw new BadRequestException(
        detail ? 'Gagal mengambil info video: ' + detail : 'Gagal mengambil info video. Pastikan tautan publik dan coba lagi.',
      );
    }

    let data: Record<string, unknown>;
    try {
      data = (typeof parsed === 'string' ? JSON.parse(parsed) : parsed) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('Info video dari yt-dlp tidak bisa dibaca.');
    }
    if (!data || data._type === 'playlist') {
      throw new BadRequestException('Tautan ini berisi playlist. Gunakan tautan satu video.');
    }

    const host = new URL(request.url).hostname.replace(/^www\./, '');
    const extractor = text(data.extractor, 80);
    if (isBilibiliHost(host) && /generic/i.test(extractor)) {
      throw new BadRequestException(
        'Tautan Bilibili tidak bisa dibuka. Buka di browser, lalu tempel URL video lengkap (bilibili.com/video/BV...).',
      );
    }

    const formats = Array.isArray(data.formats)
      ? (data.formats as Array<Record<string, unknown>>).filter((item) => item && typeof item === 'object')
      : [];
    const heights = [
      ...new Set(
        formats
          .filter((item) => typeof item.vcodec === 'string' && item.vcodec !== 'none')
          .map((item) => Number(item.height))
          .filter((height) => Number.isInteger(height) && height >= 144 && height <= 4320),
      ),
    ].sort((a, b) => b - a);
    const hasAudio = formats.length === 0 || formats.some((item) => typeof item.acodec === 'string' && item.acodec !== 'none');

    const thumbs = Array.isArray(data.thumbnails)
      ? (data.thumbnails as Array<Record<string, unknown>>)
          .map((item) => ({ url: httpUrl(item.url), width: Number(item.width) || 0 }))
          .filter((item): item is { url: string; width: number } => Boolean(item.url))
          .sort((a, b) => b.width - a.width)
      : [];
    const thumbnail = httpUrl(data.thumbnail) ?? thumbs[0]?.url ?? null;

    return {
      url: request.url,
      id: text(data.id, 120),
      title: text(data.title, 300),
      uploader: text(data.uploader ?? data.channel ?? data.creator, 160),
      duration: Number.isFinite(Number(data.duration)) ? Number(data.duration) : null,
      thumbnail,
      source: host,
      webpageUrl: httpUrl(data.webpage_url) ?? request.url,
      heights,
      hasAudio,
      live: data.is_live === true || data.live_status === 'is_live',
    };
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
