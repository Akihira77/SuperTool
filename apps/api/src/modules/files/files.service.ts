import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { copyFile, open, readdir, stat, mkdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { cfg } from '../../config';
import { jailPath } from '../../common/fs-jail';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { touchPath } from '../../common/db';
import { utf8Cut } from '../../common/text-chunk';
import { isOffice, previewOffice, saveOfficeEdits } from './office';
import sharp from 'sharp';

const TEXT_LIMIT = 2 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const SEARCH_MAX = 200;
const GREP_MAX = 300;
const THUMB_SIZE = 96;
const THUMB_IMAGE = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'tif', 'tiff', 'svg']);
const THUMB_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov', 'ogv']);

/** Pencocokan glob sederhana: '*' -> apa saja, '?' -> satu karakter. */
function globMatch(glob: string, name: string): boolean {
  const escaped = glob
    .replace(/[.+^$${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$', 'i').test(name);
}
const exec = promisify(execFile);
const SKIP_DIRS = new Set(['node_modules', '.git', '.cache', '__pycache__', 'dist', '.next']);
/** Folder berat yang selalu dilewati pencarian isi (grep maupun rg). */
const SKIP_DIRS_GIT = ['node_modules', '.git', 'dist', '.cache', '.pnpm-store', '__pycache__', '.next'];

export type Entry = {
  name: string;
  path: string;
  dir: boolean;
  size: number;
  mtime: number;
  ext: string;
  hidden: boolean;
};

@Injectable()
export class FilesService {
  /** Deteksi ripgrep sekali; kalau ada, pencarian isi jauh lebih cepat dari grep. */
  private rgReady?: Promise<boolean>;

  private hasRg(): Promise<boolean> {
    this.rgReady ??= new Promise<boolean>((resolve) => {
      const child = spawn('rg', ['--version'], { stdio: 'ignore' });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
    return this.rgReady;
  }


  /** Thumbnail kecil untuk daftar berkas: gambar lewat sharp, video lewat ffmpeg (kalau ada). */
  private thumbs = new Map<string, Buffer>();
  private ffmpegReady?: Promise<boolean>;
  private thumbJobs = 0;
  private readonly thumbWaiters: Array<() => void> = [];

  private hasFfmpeg(): Promise<boolean> {
    this.ffmpegReady ??= exec('ffmpeg', ['-version'], { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    return this.ffmpegReady;
  }

  /** Batasi thumbnail (sharp/ffmpeg) supaya daftar folder besar tidak memicu puluhan proses sekaligus. */
  private async withThumbSlot<T>(task: () => Promise<T>): Promise<T> {
    while (this.thumbJobs >= 2) await new Promise<void>((resolve) => this.thumbWaiters.push(resolve));
    this.thumbJobs += 1;
    try {
      return await task();
    } finally {
      this.thumbJobs -= 1;
      this.thumbWaiters.shift()?.();
    }
  }

  private videoFrame(abs: string, at: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        'ffmpeg',
        [
          '-nostdin',
          '-ss', String(at),
          '-i', abs,
          '-frames:v', '1',
          '-an',
          '-threads', '1',
          '-vf', 'scale=' + THUMB_SIZE + ':' + THUMB_SIZE + ':force_original_aspect_ratio=increase,crop=' + THUMB_SIZE + ':' + THUMB_SIZE,
          '-f', 'image2pipe',
          '-vcodec', 'webp',
          'pipe:1',
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
      const done = (err: Error | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err || !size) reject(err ?? new Error('ffmpeg tidak menghasilkan frame'));
        else resolve(Buffer.concat(chunks));
      };
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) child.kill('SIGKILL');
        else chunks.push(chunk);
      });
      child.on('error', (err) => done(err));
      child.on('close', (code) => done(code === 0 ? null : new Error('ffmpeg keluar dengan kode ' + code)));
    });
  }

  async thumbnail(input: string): Promise<Buffer> {
    const abs = await jailPath(input);
    const info = await stat(abs).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException('Berkas tidak ditemukan');
    const ext = extname(abs).slice(1).toLowerCase();
    const key = abs + ':' + info.mtimeMs;
    const cached = this.thumbs.get(key);
    if (cached) return cached;

    let body: Buffer;
    try {
      if (THUMB_IMAGE.has(ext)) {
        body = await this.withThumbSlot(() =>
          sharp(abs, { failOn: 'none' }).rotate().resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover' }).webp({ quality: 72 }).toBuffer(),
        );
      } else if (THUMB_VIDEO.has(ext)) {
        if (!(await this.hasFfmpeg())) {
          throw new BadRequestException('Thumbnail video butuh ffmpeg yang belum terpasang');
        }
        body = await this.withThumbSlot(() => this.videoFrame(abs, 1).catch(() => this.videoFrame(abs, 0)));
      } else {
        throw new BadRequestException('Berkas ini tidak punya thumbnail');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Gagal membuat thumbnail: ' + (err as Error).message.slice(0, 120));
    }
    this.thumbs.set(key, body);
    if (this.thumbs.size > 300) {
      const oldest = this.thumbs.keys().next().value;
      if (oldest) this.thumbs.delete(oldest);
    }
    return body;
  }

  /** Ubah include ("apps/api", "src") jadi path absolut yang aman — pencarian hanya di situ. */
  private async includeTargets(start: string, include: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const raw of include) {
      if (!raw || /[*?[\]{}]/.test(raw)) continue;
      const abs = raw.startsWith('/') ? raw : join(start, raw);
      // include absolut / traversal tetap harus lewat jail + cek symlink.
      const safe = await jailPath(abs);
      try {
        const info = await stat(safe);
        if (info.isDirectory() || info.isFile()) out.push(safe);
      } catch {
        // path tidak ada: biarkan filter hasil yang menangani
      }
    }
    return out;
  }

  roots() {
    return cfg.fsRoots.map((path) => ({ path, label: basename(path) || path }));
  }

  async list(input: string): Promise<{ path: string; parent: string | null; entries: Entry[]; truncated: boolean }> {
    const path = await jailPath(input);
    const dirents = await readdir(path, { withFileTypes: true });
    const truncated = dirents.length > MAX_ENTRIES;
    const entries: Entry[] = [];
    for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
      const full = join(path, dirent.name);
      let size = 0;
      let mtime = 0;
      try {
        const info = await stat(full);
        size = info.size;
        mtime = info.mtimeMs;
      } catch {
        // entri tidak terbaca (permission) tetap ditampilkan tanpa metadata
      }
      entries.push({
        name: dirent.name,
        path: full,
        dir: dirent.isDirectory(),
        size: dirent.isDirectory() ? 0 : size,
        mtime,
        ext: dirent.isDirectory() ? '' : extname(dirent.name).slice(1).toLowerCase(),
        hidden: dirent.name.startsWith('.'),
      });
    }
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'id'));
    const parent = cfg.fsRoots.includes(path) ? null : dirname(path);
    return { path, parent, entries, truncated };
  }

  async readText(input: string, offsetInput?: string) {
    const path = await jailPath(input);
    const info = await stat(path);
    if (!info.isFile()) throw new BadRequestException('Bukan file');
    const offset = offsetInput === undefined || offsetInput === '' ? 0 : Number(offsetInput);
    if (!Number.isInteger(offset) || offset < 0 || offset > info.size) {
      throw new BadRequestException('Offset tidak valid');
    }
    touchPath('file', path);
    const meta = { path, size: info.size, mtime: info.mtimeMs, ext: extname(path).slice(1).toLowerCase() };

    const handle = await open(path, 'r');
    let head = Buffer.alloc(0);
    let buffer = Buffer.alloc(0);
    try {
      // Deteksi biner hanya dari 8 KB awal, tanpa membaca seluruh berkas.
      const headSize = Math.min(info.size, 8192);
      if (headSize > 0) {
        head = Buffer.alloc(headSize);
        await handle.read(head, 0, headSize, 0);
      }
      if (head.includes(0)) {
        return { ...meta, binary: true, offset: 0, returned: 0, more: false, text: '', truncated: false };
      }
      // Baca satu chunk + sisa maksimal 3 byte untuk memotong di batas UTF-8.
      const take = Math.min(TEXT_LIMIT + 4, info.size - offset);
      if (take > 0) {
        buffer = Buffer.alloc(take);
        const { bytesRead } = await handle.read(buffer, 0, take, offset);
        buffer = buffer.subarray(0, bytesRead);
      }
    } finally {
      await handle.close();
    }

    const returned = utf8Cut(buffer, Math.min(buffer.length, TEXT_LIMIT));
    const more = offset + returned < info.size;
    return {
      ...meta,
      binary: false,
      offset,
      returned,
      more,
      text: buffer.subarray(0, returned).toString('utf8'),
      truncated: more,
    };
  }

  /** Pratinjau docx/xlsx/pptx/odt/ods/odp tanpa library. */
  async office(input: string) {
    const path = await jailPath(input);
    const info = await stat(path);
    if (!info.isFile()) throw new BadRequestException('Bukan file');
    if (!isOffice(path)) throw new BadRequestException('Bukan berkas office yang didukung');
    touchPath('file', path);
    return { path, size: info.size, mtime: info.mtimeMs, ...(await previewOffice(path)) };
  }

  /** Simpan edit teks (docx) atau sel (xlsx). */
  async saveOffice(input: string, patch: { texts?: string[]; cells?: Array<{ sheet: number; ref: string; value: string }> }) {
    const path = await jailPath(input);
    const info = await stat(path);
    if (!info.isFile()) throw new BadRequestException('Bukan file');
    const result = await saveOfficeEdits(path, patch ?? {});
    touchPath('file', path);
    const after = await stat(path);
    return { ...result, path, size: after.size };
  }

  async writeText(input: string, content: string): Promise<{ ok: true; size: number }> {
    if (typeof content !== 'string') throw new BadRequestException('content harus string');
    const path = await jailPath(input);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
    const info = await stat(path);
    return { ok: true, size: info.size };
  }

  async makeDir(input: string): Promise<{ ok: true; path: string }> {
    const path = await jailPath(input);
    await mkdir(path, { recursive: true });
    return { ok: true, path };
  }

  async renameTo(input: string, name: string): Promise<{ ok: true; path: string }> {
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw new BadRequestException('Nama tidak valid');
    }
    const path = await jailPath(input);
    const target = await jailPath(join(dirname(path), name));
    await rename(path, target);
    return { ok: true, path: target };
  }

  async remove(input: string): Promise<{ ok: true }> {
    const path = await jailPath(input);
    if (cfg.fsRoots.includes(path)) throw new BadRequestException('Root tidak boleh dihapus');
    await rm(path, { recursive: true });
    return { ok: true };
  }

  /**
   * Cari kata di dalam berkas (bukan nama berkas) memakai grep rekursif.
   * Berkas biner dilewati, hasil dibatasi GREP_MAX baris.
   *
   * Memakai spawn supaya bisa berhenti begitu kuota terpenuhi: grep bisa memakan
   * waktu lama di folder besar, dan exit code 2 (misal ada subfolder tanpa izin)
   * tidak boleh membuang hasil yang sudah didapat.
   */
  async grepText(root: string, query: string, limit = GREP_MAX, exclude: string[] = [], include: string[] = [], signal?: AbortSignal) {
    const start = await jailPath(root);
    const needle = String(query ?? '');
    if (needle.trim().length < 2) throw new BadRequestException('Kata kunci minimal 2 karakter');
    const max = Math.min(GREP_MAX, Math.max(1, Number(limit) || GREP_MAX));

    const rg = await this.hasRg();
    const targets = await this.includeTargets(start, include);
    const paths = targets.length ? targets : [start];
    const args = rg
      ? [
          '--line-number',
          '--no-heading',
          '--color',
          'never',
          '--max-count',
          '20',
          '--max-filesize',
          '2M',
          ...SKIP_DIRS_GIT.map((dir) => '--glob=!' + dir + '/**'),
          ...exclude.map((glob) => '--glob=!' + (glob.endsWith('/') ? glob + '**' : glob)),
          '-F',
          '-e',
          needle,
          ...paths,
        ]
      : [
          '-rIn',
          '--binary-files=without-match',
          ...SKIP_DIRS_GIT.map((dir) => '--exclude-dir=' + dir),
          // Pola exclude dari UI: berkas (*.log) dan folder (node_modules/).
          ...exclude.filter((glob) => !glob.endsWith('/')).map((glob) => '--exclude=' + glob),
          ...exclude.filter((glob) => glob.endsWith('/')).map((glob) => '--exclude-dir=' + glob.slice(0, -1)),
          '-m',
          '20',
          '-F',
          '-e',
          needle,
          ...paths,
        ];

    const results: Array<{ path: string; line: number; text: string }> = [];
    const warnings: string[] = [];
    // include = batasi hasil ke path yang memuat salah satu potongan ini.
    const keep = (path: string) => !include.length || include.some((prefix) => path.includes(prefix));

    return new Promise<{ results: typeof results; truncated: boolean; warning?: string }>((resolve, reject) => {
      const child = spawn(rg ? 'rg' : 'grep', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let buffer = '';
      let stderr = '';
      let settled = false;

      const finish = (error?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (results.length) {
          resolve({ results, truncated: results.length >= max, warning: warnings[0] });
          return;
        }
        if (error) {
          reject(new BadRequestException('Pencarian gagal: ' + error.slice(0, 140)));
          return;
        }
        resolve({ results, truncated: false, warning: warnings[0] });
      };

      const timer = setTimeout(() => {
        warnings.push('Pencarian dihentikan setelah 20 detik, hasil bisa belum lengkap.');
        child.kill('SIGKILL');
        finish();
      }, 20_000);

      const parse = (line: string) => {
        const first = line.indexOf(':');
        const second = line.indexOf(':', first + 1);
        if (first < 0 || second < 0) return;
        const filePath = line.slice(0, first);
        if (!keep(filePath)) return;
        results.push({
          path: filePath,
          line: Number(line.slice(first + 1, second)) || 0,
          text: line.slice(second + 1).slice(0, 300),
        });
        if (results.length >= max) {
          child.kill('SIGKILL');
          finish();
        }
      };

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let index = buffer.indexOf('\n');
        while (index >= 0) {
          parse(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          if (settled) return;
          index = buffer.indexOf('\n');
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 4000) stderr = stderr.slice(0, 4000);
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new BadRequestException('Perintah grep tidak tersedia: ' + (err as Error).message.slice(0, 120)));
      });

      if (signal) {
        signal.addEventListener('abort', () => child.kill('SIGKILL'), { once: true });
        if (signal.aborted) child.kill('SIGKILL');
      }

      child.on('close', (code) => {
        if (buffer.trim()) parse(buffer);
        const noisy = stderr
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line && !line.includes('Permission denied') && !line.includes('No such file'));
        if (noisy) warnings.push(noisy.slice(0, 160));
        if (code === 0 || code === 1 || code === null) finish();
        else if (results.length) finish();
        else if (!noisy) {
          // exit 2 tanpa pesan nyata = hanya ada folder tanpa izin, bukan kegagalan.
          warnings.push('Sebagian folder tidak bisa dibaca (izin ditolak).');
          finish();
        } else finish(noisy);
      });
    });
  }

  async search(root: string, query: string, includeAll: boolean, exclude: string[] = [], include: string[] = []) {
    if (!query || query.length < 2) throw new BadRequestException('Query minimal 2 karakter');
    const start = await jailPath(root);
    const needle = query.toLowerCase();
    const results: Entry[] = [];
    const targets = await this.includeTargets(start, include);
    // Kalau include menunjuk folder tertentu, jangan telusuri seluruh pohon.
    const near = (path: string) => !targets.length || targets.some((target) => path === target || path.startsWith(target + '/') || target.startsWith(path + '/'));
    const stack: { dir: string; depth: number }[] = [{ dir: start, depth: 0 }];
    while (stack.length && results.length < SEARCH_MAX) {
      const { dir, depth } = stack.pop()!;
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        const full = join(dir, dirent.name);
        if (exclude.some((glob) => globMatch(glob.replace(/\/$/, ''), dirent.name))) continue;
        if (dirent.name.toLowerCase().includes(needle) && near(full)) {
          let size = 0;
          let mtime = 0;
          try {
            const info = await stat(full);
            size = info.size;
            mtime = info.mtimeMs;
          } catch {
            // abaikan
          }
          results.push({
            name: dirent.name,
            path: full,
            dir: dirent.isDirectory(),
            size,
            mtime,
            ext: dirent.isDirectory() ? '' : extname(dirent.name).slice(1).toLowerCase(),
            hidden: dirent.name.startsWith('.'),
          });
          if (results.length >= SEARCH_MAX) break;
        }
        if (dirent.isDirectory() && depth < 12 && near(full)) {
          if (!includeAll && SKIP_DIRS.has(dirent.name)) continue;
          if (dirent.name.startsWith('.') && !includeAll) continue;
          stack.push({ dir: full, depth: depth + 1 });
        }
      }
    }
    const filtered = include.length ? results.filter((entry) => include.some((prefix) => entry.path.includes(prefix))) : results;
    return { results: filtered, truncated: results.length >= SEARCH_MAX };
  }

  async dirSize(input: string) {
    const start = await jailPath(input);
    let bytes = 0;
    let files = 0;
    let visited = 0;
    const stack = [start];
    while (stack.length && visited < 50000) {
      const dir = stack.pop()!;
      let dirents;
      try {
        dirents = await readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const dirent of dirents) {
        const full = join(dir, dirent.name);
        visited += 1;
        if (dirent.isDirectory()) stack.push(full);
        else {
          try {
            bytes += (await stat(full)).size;
            files += 1;
          } catch {
            // abaikan
          }
        }
      }
    }
    return { bytes, files, truncated: visited >= 50000 };
  }

  async saveUpload(dirInput: string, name: string, tempPath: string) {
    if (!name) throw new NotFoundException('Nama file kosong');
    if (!tempPath) throw new BadRequestException('Berkas upload kosong');
    const dir = await jailPath(dirInput);
    const target = await jailPath(join(dir, basename(name)));
    let copied: string | null = null;
    try {
      try {
        await rename(tempPath, target);
      } catch (err) {
        // Folder temp dan target bisa beda filesystem (mis. /tmp tmpfs).
        // copyFile streaming ke disk, lalu rename agar target lama tidak rusak
        // kalau penyalinan gagal di tengah jalan.
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        copied = target + '.upload-' + process.pid + '-' + Date.now();
        await copyFile(tempPath, copied);
        await rename(copied, target);
      }
    } finally {
      await unlink(tempPath).catch(() => undefined);
      if (copied) await unlink(copied).catch(() => undefined);
    }
    const info = await stat(target);
    return { ok: true, path: target, size: info.size };
  }
}