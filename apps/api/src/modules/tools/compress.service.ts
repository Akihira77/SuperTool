import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { jailPath } from '../../common/fs-jail';
import { JobsService } from '../jobs/jobs.service';

const exec = promisify(execFile);

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'tif', 'tiff']);
const PDF_EXT = new Set(['pdf']);
const CONVERT_TARGETS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp']);
const MAX_PDF_FALLBACK = 50 * 1024 * 1024;
const GS_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const GS_MAX_BUFFER = 4 * 1024 * 1024;

export type CompressResult = {
  input: { path: string; size: number };
  output: { path: string; size: number };
  saved: number;
  percent: number;
  note?: string;
  pages?: number;
};

type JobState = {
  id: string;
  label: string;
  state: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  result?: CompressResult;
  error?: string;
};

function friendlyMessage(err: unknown, fallback: string): string {
  const message = String((err as Error)?.message ?? err ?? '');
  if (/password|encrypted|encrypt/i.test(message)) return 'Berkas terkunci password, tidak bisa diproses.';
  if (/invalid pdf|failed to parse|cannot parse|corrupt/i.test(message)) return 'PDF rusak atau tidak bisa dibaca.';
  if (/unsupported image format|unsupported image|input buffer/i.test(message)) return 'Format gambar tidak didukung atau berkas rusak.';
  if (/bukan berkas zip|zip/i.test(message)) return 'Berkas office rusak atau bukan format yang didukung.';
  return fallback + (message ? ' (' + message.slice(0, 140) + ')' : '');
}

const POWERED = ['gs', 'pdftoppm'] as const;
type Tool = (typeof POWERED)[number];

@Injectable()
export class CompressService {
  private tools: Promise<Record<Tool, boolean>> | null = null;
  // Ghostscript pdfwrite memakai RAM besar untuk PDF kompleks. Satu proses
  // besar pada satu waktu supaya dua file GB tidak saling menghabiskan memori.
  private pdfQueue: Promise<void> = Promise.resolve();

  constructor(private readonly jobs: JobsService) {
    jobs.register('compress:image', {
      run: (payload) => this.runImage(String(payload.input ?? ''), (payload.options ?? {}) as { quality?: number; maxWidth?: number; format?: string }),
    });
    jobs.register('compress:pdf', {
      run: (payload) => this.serializePdf(() => this.runPdf(String(payload.input ?? ''), (payload.options ?? {}) as { mode?: string })),
    });
    jobs.register('compress:convert', {
      run: (payload) => this.runConvert(String(payload.input ?? ''), (payload.options ?? {}) as { target?: string; quality?: number; dpi?: number }),
    });
  }

  private detect(): Promise<Record<Tool, boolean>> {
    if (!this.tools) {
      this.tools = (async () => {
        const out = {} as Record<Tool, boolean>;
        for (const tool of POWERED) {
          try {
            await exec(tool, tool === 'gs' ? ['--version'] : ['-v'], { timeout: 5000 });
            out[tool] = true;
          } catch (err) {
            // pdftoppm mengembalikan kode != 0 saat -v, tapi binary-nya ada
            out[tool] = tool === 'pdftoppm' && (err as { code?: string }).code !== 'ENOENT';
          }
        }
        return out;
      })();
    }
    return this.tools;
  }

  async info() {
    await this.detect();
    const tools = await this.detect();
    return {
      image: true,
      pdf: tools.gs ? 'ghostscript' : 'pdf-lib',
      pdfToImage: tools.pdftoppm,
      convert: true,
    };
  }

  job(id: string): JobState {
    const job = this.jobs.get(String(id ?? ''));
    if (!job) throw new NotFoundException('Proses tidak ditemukan');
    return {
      id: job.id,
      label: job.label,
      state: job.status === 'completed' ? 'done' : job.status === 'failed' || job.status === 'cancelled' ? 'error' : 'running',
      startedAt: job.startedAt ?? job.createdAt,
      finishedAt: job.completedAt ?? undefined,
      result: (job.result as CompressResult | null) ?? undefined,
      error: job.error ?? (job.status === 'cancelled' ? 'Dibatalkan.' : undefined),
    };
  }

  /** Kerja masuk antrean job persisten; respons HTTP hanya membawa jobId. */
  private startJob(type: string, label: string, payload: Record<string, unknown>): { jobId: string } {
    return { jobId: this.jobs.start(type, payload, { label }).id };
  }

  image(input: string, options: { quality?: number; maxWidth?: number; format?: string }) {
    return this.startJob('compress:image', 'kompres gambar', { input, options });
  }

  pdf(input: string, options: { mode?: string }) {
    return this.startJob('compress:pdf', 'kompres pdf', { input, options });
  }

  private serializePdf<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.pdfQueue;
    let release!: () => void;
    this.pdfQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(async () => {
      try {
        return await work();
      } finally {
        release();
      }
    });
  }

  convert(input: string, options: { target?: string; quality?: number; dpi?: number }) {
    return this.startJob('compress:convert', 'konversi', { input, options });
  }

  private async runImage(input: string, options: { quality?: number; maxWidth?: number; format?: string }): Promise<CompressResult> {
    const source = await jailPath(input);
    const ext = extname(source).slice(1).toLowerCase();
    if (!IMAGE_EXT.has(ext)) throw new BadRequestException('Bukan berkas gambar yang didukung');
    const info = await stat(source);
    if (info.size > 80 * 1024 * 1024) throw new BadRequestException('Gambar terlalu besar (>80 MB)');

    const format = (options.format ?? (ext === 'jpeg' ? 'jpg' : ext)).toLowerCase();
    if (!['jpg', 'jpeg', 'png', 'webp', 'avif'].includes(format)) throw new BadRequestException('Format tujuan tidak didukung');
    const quality = Math.min(100, Math.max(30, Number(options.quality ?? 78)));
    const maxWidth = Number(options.maxWidth ?? 2000);

    let pipeline = sharp(source, { failOn: 'none' }).rotate();
    const meta = await pipeline.metadata();
    if (maxWidth > 0 && (meta.width ?? 0) > maxWidth) {
      pipeline = pipeline.resize({ width: Math.round(maxWidth), withoutEnlargement: true });
    }
    if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9, palette: true, quality });
    else if (format === 'webp') pipeline = pipeline.webp({ quality, effort: 5 });
    else if (format === 'avif') pipeline = pipeline.avif({ quality, effort: 5 });
    else pipeline = pipeline.jpeg({ quality, mozjpeg: true });

    const dest = replaceName(source, '-min', format === 'jpeg' ? 'jpg' : format);
    await pipeline.toFile(dest);
    return this.result(source, dest);
  }

  private async runPdf(input: string, options: { mode?: string }): Promise<CompressResult> {
    const source = await jailPath(input);
    if (!PDF_EXT.has(extname(source).slice(1).toLowerCase())) throw new BadRequestException('Bukan berkas PDF');
    const info = await stat(source);

    const dest = replaceName(source, '-min', 'pdf');
    const tools = await this.detect();

    if (tools.gs) {
      // Output ditulis ke berkas sementara di folder yang sama, lalu di-rename
      // setelah sukses. Tidak ada PDF yang dimuat ke memori Node.
      const temp = dest + '.part-' + process.pid + '-' + Date.now();
      try {
        await exec(
          'gs',
          [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.5',
            '-dPDFSETTINGS=' + (options.mode === 'max' ? '/ebook' : '/printer'),
            '-dSAFER',
            '-dPDFSTOPONERROR',
            '-dNOPAUSE',
            '-dBATCH',
            '-dQUIET',
            '-sOutputFile=' + temp,
            source,
          ],
          { timeout: GS_TIMEOUT_MS, maxBuffer: GS_MAX_BUFFER },
        );
        await rename(temp, dest);
      } catch (err) {
        await unlink(temp).catch(() => undefined);
        throw err;
      }
      return this.result(source, dest, 'Dikompres streaming dengan ghostscript');
    }

    // Tanpa ghostscript: pdf-lib memuat seluruh berkas ke memori. Batasi
    // ukuran agar PDF ratusan MB/GB tidak menghabiskan RAM server.
    if (info.size > MAX_PDF_FALLBACK) {
      throw new BadRequestException(
        'PDF >50 MB membutuhkan ghostscript. Pasang ghostscript lalu coba lagi (lihat README bagian Alat eksternal).',
      );
    }
    const bytes = await readFile(source);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
    await writeFile(dest, await doc.save({ useObjectStreams: true, addDefaultPage: false }));
    return this.result(
      source,
      dest,
      'Disimpan ulang dengan object stream. Pasang ghostscript untuk PDF besar (lihat README).',
    );
  }

  private async runConvert(input: string, options: { target?: string; quality?: number; dpi?: number }): Promise<CompressResult> {
    const source = await jailPath(input);
    const ext = extname(source).slice(1).toLowerCase();
    const target = String(options.target ?? '').toLowerCase();
    if (!CONVERT_TARGETS.has(target)) throw new BadRequestException('Target konversi tidak didukung');

    if (target === 'pdf') {
      if (!IMAGE_EXT.has(ext)) throw new BadRequestException('Ke PDF hanya untuk berkas gambar');
      return this.imageToPdf(source, options.quality);
    }
    if (PDF_EXT.has(ext)) {
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(target)) throw new BadRequestException('PDF hanya bisa dikonversi ke gambar');
      return this.pdfToImage(source, target, options.dpi);
    }
    if (!IMAGE_EXT.has(ext)) throw new BadRequestException('Konversi ini belum didukung');
    return this.imageToImage(source, target, options.quality);
  }

  private async imageToPdf(source: string, quality = 80): Promise<CompressResult> {
    const ext = extname(source).slice(1).toLowerCase();
    const doc = await PDFDocument.create();
    let embedded;
    if (ext === 'jpg' || ext === 'jpeg') {
      embedded = await doc.embedJpg(await readFile(source));
    } else {
      const buffer = await sharp(source, { failOn: 'none' })
        .rotate()
        .jpeg({ quality })
        .toBuffer();
      embedded = await doc.embedJpg(buffer);
    }
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    const dest = replaceName(source, '-conv', 'pdf');
    await writeFile(dest, await doc.save());
    return this.result(source, dest, 'Gambar dijadikan PDF');
  }

  private async pdfToImage(source: string, target: string, dpi = 150): Promise<CompressResult> {
    const tools = await this.detect();
    if (!tools.pdftoppm) {
      throw new BadRequestException('Konversi PDF ke gambar butuh poppler-utils (pdftoppm). Lihat README.');
    }
    const pages = Math.min(5, Math.max(1, Number(dpi) > 300 ? 1 : 3));
    const prefix = replaceName(source, '-page', '');
    const args = ['-r', String(Math.min(300, Math.max(72, dpi))), '-f', '1', '-l', String(pages)];
    if (target === 'jpg' || target === 'jpeg') args.push('-jpeg');
    else if (target === 'png') args.push('-png');
    else args.push('-png');
    await exec('pdftoppm', [...args, source, prefix], { timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });

    let first = prefix + '-1.png';
    if (target === 'jpg' || target === 'jpeg') first = prefix + '-1.jpg';
    if (target === 'webp') {
      const png = prefix + '-1.png';
      await sharp(png).webp({ quality: 85 }).toFile(prefix + '-1.webp');
      first = prefix + '-1.webp';
    }
    return this.result(source, first, 'Halaman PDF dipecah jadi gambar (' + pages + ' halaman pertama)');
  }

  private async imageToImage(source: string, target: string, quality = 85): Promise<CompressResult> {
    const format = target === 'jpeg' ? 'jpg' : target;
    let pipeline = sharp(source, { failOn: 'none' }).rotate();
    if (format === 'png') pipeline = pipeline.png({ compressionLevel: 9 });
    else if (format === 'webp') pipeline = pipeline.webp({ quality });
    else pipeline = pipeline.jpeg({ quality });
    const dest = replaceName(source, '-conv', format);
    await pipeline.toFile(dest);
    return this.result(source, dest, 'Format diubah ke ' + format.toUpperCase());
  }

  private async result(inputPath: string, outputPathValue: string, note?: string): Promise<CompressResult> {
    const [before, after] = await Promise.all([stat(inputPath), stat(outputPathValue)]);
    const saved = before.size - after.size;
    return {
      input: { path: inputPath, size: before.size },
      output: { path: outputPathValue, size: after.size },
      saved,
      percent: before.size ? Math.round((saved / before.size) * 1000) / 10 : 0,
      note,
    };
  }
}

function replaceName(path: string, suffix: string, ext: string): string {
  const name = basename(path, extname(path));
  return join(dirname(path), name + suffix + (ext ? '.' + ext : ''));
}
