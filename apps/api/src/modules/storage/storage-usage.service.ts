import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { execFile, spawn } from 'node:child_process';
import { lstat, readdir, realpath, rm, statfs } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { cfg } from '../../config';
import { jailPath } from '../../common/fs-jail';

const exec = promisify(execFile);
// Cache 30 menit: scan bisa puluhan detik, dan tombol "Pindai ulang" tetap
// memaksa data segar. Cache disimpan di SQLite supaya bertahan setelah restart.
const CACHE_MS = 30 * 60_000;
// Folder besar (mis. home 58 GB) bisa lebih dari 45 detik; beri ruang lebih.
const FOLDER_TIMEOUT_MS = 5 * 60_000;
const SCAN_CONCURRENCY = 8;
const MAX_CHILDREN = 200;
const MAX_OUTPUT = 8 * 1024 * 1024;
const SYSTEM_EXCLUDES = ['snap', 'lost+found'];

/** Folder yang aman dihapus dari UI. Jangan izinkan path sembarang. */
const CLEANABLE = new Set([
  'node_modules',
  'temp',
  '.cache',
  '.next',
  '.nuxt',
  '.output',
  '.parcel-cache',
  '.pnpm-store',
  '.turbo',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'out',
  'target',
  'vendor',
]);

export type UsageNode = {
  name: string;
  path: string;
  size: number;
  depth: number;
  cleanable: boolean;
  children?: UsageNode[];
};

export type UsageResult = {
  root: string;
  total: number;
  scannedAt: number;
  truncated: boolean;
  warning?: string;
  count: number;
  disk?: { total: number; free: number };
  tree: UsageNode[];
};

export function isCleanableFolder(name: string): boolean {
  return CLEANABLE.has(name);
}

type ParsedEntry = { path: string; size: number };

/** Parse keluaran `du -0`: setiap record "ukuran\tpath\0". */
export function parseDuOutput(raw: string, root: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  for (const record of raw.split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 1) continue;
    const size = Number(record.slice(0, tab));
    const path = record.slice(tab + 1);
    if (!Number.isFinite(size) || size < 0) continue;
    if (path === root || path.startsWith(root + sep)) entries.push({ path, size });
  }
  return entries;
}

function sortNodes(nodes: UsageNode[]): UsageNode[] {
  nodes.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  for (const node of nodes) if (node.children) node.children = sortNodes(node.children);
  return nodes;
}

@Injectable()
export class StorageUsageService {
  private cache: { at: number; data: UsageResult } | null = null;
  private scanning: Promise<UsageResult> | null = null;

  async usage(refresh = false): Promise<UsageResult> {
    if (!refresh && this.cache && Date.now() - this.cache.at < CACHE_MS) {
      return this.cache.data;
    }
    if (!refresh && !this.cache) {
      const stored = await this.readStoredCache();
      if (stored && Date.now() - stored.at < CACHE_MS) {
        this.cache = stored;
        return stored.data;
      }
    }
    // Satu proses du saja; permintaan kedua menunggu hasil yang sama.
    if (this.scanning) return this.scanning;
    this.scanning = this.scan()
      .then(async (data) => {
        this.cache = { at: data.scannedAt, data };
        await this.writeStoredCache(data);
        return data;
      })
      .finally(() => {
        this.scanning = null;
      });
    return this.scanning;
  }

  // Import DB dibuat dinamis supaya selfcheck yang hanya memakai fungsi murni
  // tidak ikut membuka database aplikasi.
  private async readStoredCache(): Promise<{ at: number; data: UsageResult } | null> {
    try {
      const { one } = await import('../../common/db');
      const row = one<{ data: string; scannedAt: number }>(
        'SELECT data, scanned_at AS scannedAt FROM storage_cache WHERE id = 1',
      );
      if (!row || !Number.isFinite(row.scannedAt)) return null;
      const data = JSON.parse(row.data) as UsageResult;
      if (!data || !Array.isArray(data.tree) || typeof data.total !== 'number') return null;
      return { at: row.scannedAt, data };
    } catch {
      return null;
    }
  }

  private async writeStoredCache(data: UsageResult): Promise<void> {
    try {
      const { run } = await import('../../common/db');
      run(
        'INSERT INTO storage_cache (id, data, scanned_at) VALUES (1, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET data = excluded.data, scanned_at = excluded.scanned_at',
        JSON.stringify(data),
        data.scannedAt,
      );
    } catch {
      // Cache DB opsional; scan tetap berhasil walau penyimpanan gagal.
    }
  }

  private async clearStoredCache(): Promise<void> {
    try {
      const { run } = await import('../../common/db');
      run('DELETE FROM storage_cache WHERE id = 1');
    } catch {
      // Abaikan bila tabel/cache tidak tersedia.
    }
  }

  private async scan(): Promise<UsageResult> {
    const root = resolve(cfg.fsRoots[0] ?? cfg.dataDir);
    const dirents = await readdir(root, { withFileTypes: true });
    const dirs = dirents
      .filter((entry) => entry.isDirectory() && !SYSTEM_EXCLUDES.includes(entry.name))
      .map((entry) => resolve(root, entry.name));
    const fileSizes = await Promise.all(
      dirents.filter((entry) => entry.isFile()).map((entry) => lstat(resolve(root, entry.name)).then((info) => info.size).catch(() => 0)),
    );
    const rootFileBytes = fileSizes.reduce((sum, size) => sum + size, 0);

    const runs: Array<Awaited<ReturnType<StorageUsageService['runDu']>>> = new Array(dirs.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= dirs.length) return;
        runs[index] = await this.runDu(dirs[index]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, dirs.length) }, worker));

    const failed = runs.find((run) => run?.error);
    if (failed?.error) {
      if (failed.error.code === 'ENOENT') throw new ServiceUnavailableException('Perintah du tidak tersedia di server');
      throw new BadRequestException('Gagal memindai folder: ' + String(failed.error.message || failed.error).slice(0, 160));
    }

    const byPath = new Map<string, UsageNode>();
    let timedOut = false;
    let unreadable = false;
    let unreadableDetail = '';
    for (let index = 0; index < dirs.length; index += 1) {
      const run = runs[index];
      if (!run) continue;
      if (run.timedOut) timedOut = true;
      if (run.code !== 0) {
        unreadable = true;
        if (!unreadableDetail) {
          unreadableDetail = run.stderr
            .split('\n')
            .map((line) => line.trim())
            .find(Boolean) ?? '';
        }
      }
      for (const entry of parseDuOutput(run.raw, dirs[index])) {
        const rel = relative(root, entry.path);
        if (!rel || rel.startsWith('..')) continue;
        byPath.set(entry.path, {
          name: basename(entry.path),
          path: entry.path,
          size: entry.size,
          depth: rel.split(sep).length,
          cleanable: isCleanableFolder(basename(entry.path)),
        });
      }
    }

    const tree: UsageNode[] = [];
    for (const node of byPath.values()) {
      const parentPath = node.path.slice(0, node.path.lastIndexOf(sep));
      const parent = byPath.get(parentPath);
      if (parent) {
        (parent.children ??= []).push(node);
      } else if (node.depth === 1) {
        tree.push(node);
      }
    }

    // Hitung total sebelum trim: memotong daftar tidak boleh mengubah ukuran total.
    const total = rootFileBytes + tree.reduce((sum, node) => sum + node.size, 0);
    let truncated = false;
    const trim = (nodes: UsageNode[]) => {
      if (nodes.length > MAX_CHILDREN) {
        nodes.length = MAX_CHILDREN;
        truncated = true;
      }
      for (const node of nodes) if (node.children) trim(node.children);
    };
    sortNodes(tree);
    trim(tree);
    let count = 0;
    const walk = (nodes: UsageNode[]) => {
      for (const node of nodes) {
        count += 1;
        if (node.children) walk(node.children);
      }
    };
    walk(tree);

    let warning: string | undefined;
    if (timedOut) {
      warning = 'Sebagian folder terlalu lama dipindai; ukuran bisa belum lengkap.';
      if (unreadable) warning += ' Sebagian folder juga tidak bisa dibaca.';
    } else if (unreadable) {
      const detail = unreadableDetail.replace(/^du:\s*/, '').slice(0, 220);
      warning = 'Sebagian folder tidak bisa dibaca' + (detail ? ': ' + detail : '') + '; ukuran bisa belum lengkap.';
    } else if (truncated) {
      warning = 'Daftar dipotong agar UI tetap responsif; ukuran total tetap dihitung.';
    }

    const disk = await statfs(root)
      .then((info) => ({
        total: Number(info.bsize) * Number(info.blocks),
        free: Number(info.bsize) * Number(info.bavail),
      }))
      .catch(() => undefined);

    return {
      root,
      total,
      scannedAt: Date.now(),
      truncated: truncated || timedOut,
      warning,
      count,
      disk,
      tree,
    };
  }

  private runDu(folder: string): Promise<{
    raw: string;
    code: number | null;
    timedOut: boolean;
    stderr: string;
    error?: NodeJS.ErrnoException;
  }> {
    return new Promise((resolveResult) => {
      const args = [
        '-x',
        '-0',
        '--block-size=1',
        '--max-depth=1',
        ...SYSTEM_EXCLUDES.map((name) => '--exclude=' + name),
        folder,
      ];
      const child = spawn('du', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let stderr = '';
      let timedOut = false;
      let done = false;
      let size = 0;

      const finish = (result: { code: number | null; error?: NodeJS.ErrnoException }) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolveResult({
          raw: Buffer.concat(chunks).toString('utf8'),
          code: result.code,
          timedOut,
          stderr,
          error: result.error,
        });
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, FOLDER_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_OUTPUT) {
          timedOut = true;
          child.kill('SIGKILL');
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < 8000) stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => finish({ code: null, error }));
      child.on('close', (code) => finish({ code }));
    });
  }

  async remove(input: string): Promise<{ ok: true; path: string }> {
    const raw = String(input ?? '').trim();
    if (!raw) throw new BadRequestException('Path wajib diisi');
    const root = resolve(cfg.fsRoots[0] ?? cfg.dataDir);
    const target = await jailPath(raw, [root]);
    const realRoot = await realpath(root);
    const realTarget = await realpath(target).catch(() => null);
    if (!realTarget) throw new NotFoundException('Folder tidak ditemukan');
    const rel = relative(realRoot, realTarget);
    if (!rel || rel.startsWith('..') || rel.includes('..' + sep)) {
      throw new BadRequestException('Path di luar area monitor');
    }
    const name = basename(realTarget);
    if (!isCleanableFolder(name)) {
      throw new BadRequestException('Folder ini tidak masuk daftar aman untuk dihapus');
    }
    if ((await lstat(target)).isSymbolicLink()) throw new BadRequestException('Target berupa symlink; hapus manual');
    const info = await lstat(realTarget);
    if (!info.isDirectory()) throw new BadRequestException('Target bukan folder');
    await rm(realTarget, { recursive: true, force: false });
    this.cache = null;
    await this.clearStoredCache();
    return { ok: true, path: realTarget };
  }

  async dockerPrune(): Promise<{ ok: true; output: string }> {
    try {
      const result = await exec('docker', ['system', 'prune', '-f'], {
        timeout: 5 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      this.cache = null;
      await this.clearStoredCache();
      return { ok: true, output: (result.stdout + result.stderr).trim() };
    } catch (err) {
      const error = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      if (error.code === 'ENOENT') throw new ServiceUnavailableException('Docker tidak tersedia di server');
      const detail = (error.stderr || error.stdout || error.message || '').trim();
      throw new BadRequestException('Gagal membersihkan Docker' + (detail ? ': ' + detail.slice(0, 300) : ''));
    }
  }
}
