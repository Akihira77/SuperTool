import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { readdir, readFile, stat, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { cfg } from '../../config';
import { jailPath } from '../../common/fs-jail';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { touchPath } from '../../common/db';
import { isOffice, previewOffice, saveOfficeEdits } from './office';

const TEXT_LIMIT = 2 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const SEARCH_MAX = 200;
const GREP_MAX = 300;

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

  async readText(input: string) {
    const path = await jailPath(input);
    const info = await stat(path);
    if (!info.isFile()) throw new BadRequestException('Bukan file');
    touchPath('file', path);
    const buffer = await readFile(path);
    const head = buffer.subarray(0, 8192);
    const binary = head.includes(0);
    if (binary) {
      return { path, binary: true, size: info.size, mtime: info.mtimeMs, ext: extname(path).slice(1), text: '', truncated: false };
    }
    const slice = buffer.subarray(0, TEXT_LIMIT);
    return {
      path,
      binary: false,
      size: info.size,
      mtime: info.mtimeMs,
      ext: extname(path).slice(1).toLowerCase(),
      text: slice.toString('utf8'),
      truncated: buffer.length > TEXT_LIMIT,
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
  async grepText(root: string, query: string, limit = GREP_MAX, exclude: string[] = [], signal?: AbortSignal) {
    const start = await jailPath(root);
    const needle = String(query ?? '');
    if (needle.trim().length < 2) throw new BadRequestException('Kata kunci minimal 2 karakter');
    const max = Math.min(GREP_MAX, Math.max(1, Number(limit) || GREP_MAX));

    const args = [
      '-rIn',
      '--binary-files=without-match',
      '--exclude-dir=node_modules',
      '--exclude-dir=.git',
      '--exclude-dir=dist',
      '--exclude-dir=.cache',
      '--exclude-dir=.pnpm-store',
      // Pola exclude dari UI, contoh: *.log, *.map, *.min.js
      ...exclude.filter(Boolean).map((glob) => '--exclude=' + glob),
      '-m',
      '20',
      '-F',
      '-e',
      needle,
      start,
    ];

    const results: Array<{ path: string; line: number; text: string }> = [];
    const warnings: string[] = [];

    return new Promise<{ results: typeof results; truncated: boolean; warning?: string }>((resolve, reject) => {
      const child = spawn('grep', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
        results.push({
          path: line.slice(0, first),
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

  async search(root: string, query: string, includeAll: boolean, exclude: string[] = []) {
    if (!query || query.length < 2) throw new BadRequestException('Query minimal 2 karakter');
    const start = await jailPath(root);
    const needle = query.toLowerCase();
    const results: Entry[] = [];
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
        if (exclude.some((glob) => globMatch(glob, dirent.name))) continue;
        if (dirent.name.toLowerCase().includes(needle)) {
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
        if (dirent.isDirectory() && depth < 12) {
          if (!includeAll && SKIP_DIRS.has(dirent.name)) continue;
          if (dirent.name.startsWith('.') && !includeAll) continue;
          stack.push({ dir: full, depth: depth + 1 });
        }
      }
    }
    return { results, truncated: results.length >= SEARCH_MAX };
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

  async saveUpload(dirInput: string, name: string, data: Buffer) {
    if (!name) throw new NotFoundException('Nama file kosong');
    const dir = await jailPath(dirInput);
    const target = await jailPath(join(dir, basename(name)));
    await writeFile(target, data);
    return { ok: true, path: target, size: data.length };
  }
}