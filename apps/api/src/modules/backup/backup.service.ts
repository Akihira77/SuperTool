import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, lstat, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { ZipArchive } from 'archiver';
import type { Response } from 'express';
import { cfg } from '../../config';
import { db, replaceDatabase, SCHEMA_VERSION } from '../../common/db';

const exec = promisify(execFile);

const DB_NAME = 'super-tool.db';
const UPLOADS = 'uploads';
const MAX_UPLOAD = 100 * 1024 * 1024;
const MAX_UNZIPPED = 1024 * 1024 * 1024;
const MAX_DB = 512 * 1024 * 1024;
const MAX_ENTRIES = 3000;

type Uploaded = { originalname: string; path?: string; buffer?: Buffer; size: number };

const stamp = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + '-' + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
};

/**
 * Backup = snapshot SQLite konsisten (VACUUM INTO, bukan copy file WAL) + folder
 * uploads bila ada, dibungkus zip lewat archiver. Restore membaca balik zip itu.
 * Butuh perintah `unzip` di sistem untuk membuka arsip (lihat README).
 */
@Injectable()
export class BackupService {
  private uploadsDir() {
    return join(cfg.dataDir, UPLOADS);
  }

  async download(res: Response) {
    const temp = await mkdtemp(join(tmpdir(), 'st-backup-'));
    const snapshot = join(temp, DB_NAME);
    try {
      db.exec("VACUUM INTO '" + snapshot.replace(/'/g, "''") + "'");
    } catch (err) {
      await rm(temp, { recursive: true, force: true });
      throw new BadRequestException('Gagal membuat snapshot database: ' + (err as Error).message.slice(0, 120));
    }

    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-disposition': 'attachment; filename="super-tool-backup-' + stamp() + '.zip"',
      'cache-control': 'no-store',
    });

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on('error', (err: Error) => res.destroy(err));
    archive.pipe(res);
    archive.file(snapshot, { name: DB_NAME });
    const uploads = this.uploadsDir();
    if (existsSync(uploads)) archive.directory(uploads, UPLOADS);
    archive.append(
      JSON.stringify({ app: 'super-tool', version: 1, createdAt: Date.now(), uploads: existsSync(uploads) }, null, 2),
      { name: 'backup.json' },
    );
    await archive.finalize();
    res.on('close', () => void rm(temp, { recursive: true, force: true }));
  }

  async restore(file?: Uploaded) {
    if (!file || (!file.path && !file.buffer?.length)) throw new BadRequestException('File .zip tidak ditemukan');

    // Multer sudah menulis upload ke disk; buffer hanya dipakai pemanggil lama.
    let temp: string | null = null;
    let zipPath: string;
    if (file.path) zipPath = file.path;
    else {
      temp = await mkdtemp(join(tmpdir(), 'st-restore-'));
      zipPath = join(temp, 'upload.zip');
    }
    // Staging di folder data supaya rename ke DB/uploads tetap satu filesystem.
    const stage = await mkdtemp(join(cfg.dataDir, '.restore-'));
    try {
      if (file.size > MAX_UPLOAD) throw new BadRequestException('File backup maksimal 100 MB');
      if (!/\.zip$/i.test(file.originalname || '')) throw new BadRequestException('File harus berakhiran .zip');
      if (!file.path && file.buffer) await writeFile(zipPath, file.buffer);

      const names = await this.listZip(zipPath);
      if (!names.length) throw new BadRequestException('Arsip kosong');
      if (names.length > MAX_ENTRIES) throw new BadRequestException('Arsip berisi terlalu banyak berkas');
      for (const name of names) this.assertSafe(name);
      await this.assertNoLinks(zipPath);
      await this.assertArchiveShape(names);

      if (!names.includes(DB_NAME)) throw new BadRequestException('Backup tidak memuat ' + DB_NAME);
      const total = await this.unzippedSize(zipPath);
      if (total > MAX_UNZIPPED) throw new BadRequestException('Isi arsip terlalu besar (maks 1 GB)');

      const out = join(stage, 'out');
      await mkdir(out, { recursive: true });
      await exec('unzip', ['-o', '-q', zipPath, '-d', out]);
      await this.validateTree(out);

      const dbFile = join(out, DB_NAME);
      const info = await stat(dbFile).catch(() => null);
      if (!info?.isFile() || info.size < 512) throw new BadRequestException('File database di dalam backup tidak valid');
      if (info.size > MAX_DB) throw new BadRequestException('Database backup terlalu besar');
      await this.assertSqliteHeader(dbFile);
      await this.validateDatabase(dbFile);

      const stagedUploads = join(out, UPLOADS);
      const hasUploads = existsSync(stagedUploads);

      // Tukar uploads dulu; DB lama baru disentuh setelah arsip lolos validasi.
      const swap = await this.swapUploads(hasUploads ? stagedUploads : null);
      try {
        replaceDatabase(dbFile);
        // Hanya setelah penggantian sukses: sesi lama tidak boleh tetap valid.
        try {
          db.exec('UPDATE account SET pv = pv + 1');
        } catch {
          process.stderr.write('restore: database berhasil diganti tetapi pencabutan sesi gagal\n');
        }
        await swap.commit();
      } catch (err) {
        await swap.rollback();
        throw err;
      }

      return { ok: true, size: info.size, uploads: hasUploads, revoked: true, at: Date.now() };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const message = (err as Error).message ?? '';
      if (message.includes('ENOENT') && message.includes('unzip')) {
        throw new BadRequestException('Perintah unzip tidak tersedia di server');
      }
      throw new BadRequestException('Gagal memulihkan backup: ' + message.slice(0, 160));
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true });
      if (file.path) await rm(file.path, { force: true }).catch(() => undefined);
      await rm(stage, { recursive: true, force: true });
    }
  }

  private async listZip(zipPath: string): Promise<string[]> {
    const { stdout } = await exec('unzip', ['-Z1', zipPath], { maxBuffer: 8 * 1024 * 1024 });
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private async unzippedSize(zipPath: string): Promise<number> {
    const { stdout } = await exec('unzip', ['-l', zipPath], { maxBuffer: 8 * 1024 * 1024 });
    let total = 0;
    for (const line of stdout.split('\n')) {
      const match = /^\s*(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+/.exec(line);
      if (match) total += Number(match[1]);
    }
    return total;
  }

  /** Tolak path absolut, '..' dan backslash supaya tidak bisa menulis keluar folder sementara. */
  private assertSafe(name: string) {
    const segments = name.split('/');
    if (!name || name.startsWith('/') || name.includes('\\') || segments.includes('..')) {
      throw new BadRequestException('Arsip memuat path tidak aman: ' + name.slice(0, 80));
    }
  }

  /** Symlink bisa menunjuk keluar staging; tolak sebelum ekstraksi. */
  private async assertNoLinks(zipPath: string) {
    const { stdout } = await exec('unzip', ['-Z', '-l', zipPath], { maxBuffer: 8 * 1024 * 1024 });
    for (const line of stdout.split('\n')) {
      if (!line.startsWith('l')) continue;
      throw new BadRequestException('Arsip memuat symbolic link: ' + line.trim().slice(0, 100));
    }
  }

  /** Hanya bentuk backup yang dikenal: database, uploads, dan backup.json di root. */
  private async assertArchiveShape(names: string[]) {
    for (const name of names) {
      if (name === DB_NAME || name === 'backup.json') continue;
      if (name === UPLOADS || name === UPLOADS + '/' || name.startsWith(UPLOADS + '/')) continue;
      throw new BadRequestException('Arsip memuat entri di luar struktur backup: ' + name.slice(0, 80));
    }
  }

  /** Verifikasi isi yang benar-benar terekstrak: tanpa link, hanya file/folder biasa. */
  private async validateTree(root: string) {
    let count = 0;
    let total = 0;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop() as string;
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        const info = await lstat(abs);
        count += 1;
        if (count > MAX_ENTRIES) throw new BadRequestException('Arsip berisi terlalu banyak berkas');
        if (info.isSymbolicLink()) {
          throw new BadRequestException('Arsip memuat symbolic link: ' + entry.name.slice(0, 80));
        }
        if (info.isDirectory()) {
          stack.push(abs);
          continue;
        }
        if (!info.isFile()) {
          throw new BadRequestException('Arsip memuat entri tidak didukung: ' + entry.name.slice(0, 80));
        }
        total += info.size;
        if (total > MAX_UNZIPPED) throw new BadRequestException('Isi arsip terlalu besar (maks 1 GB)');
      }
    }
  }

  private async assertSqliteHeader(dbFile: string) {
    const handle = await open(dbFile, 'r');
    try {
      const head = Buffer.alloc(16);
      const { bytesRead } = await handle.read(head, 0, 16, 0);
      if (bytesRead !== 16 || head.toString('utf8') !== 'SQLite format 3\u0000') {
        throw new BadRequestException('File database bukan SQLite yang valid');
      }
    } finally {
      await handle.close();
    }
  }

  /** Buka salinan sebagai database: integritas, foreign key, versi skema, tabel wajib. */
  private async validateDatabase(dbFile: string) {
    let check: DatabaseSync | null = null;
    try {
      check = new DatabaseSync(dbFile);
      const integrity = check.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
      const bad = integrity.filter((row) => String(Object.values(row)[0] ?? '').toLowerCase() !== 'ok');
      if (!integrity.length || bad.length) {
        throw new BadRequestException('Integritas database backup rusak');
      }
      if ((check.prepare('PRAGMA foreign_key_check').all() as unknown[]).length) {
        throw new BadRequestException('Database backup melanggar foreign key');
      }
      const versionRow = check.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
      const version = Number(versionRow?.user_version ?? 0);
      if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
        throw new BadRequestException('Versi skema backup tidak didukung (ditemukan ' + version + ', maks ' + SCHEMA_VERSION + ')');
      }
      const tables = new Set(
        (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
      );
      for (const required of ['account', 'notes', 'urls']) {
        if (!tables.has(required)) throw new BadRequestException('Database backup tidak memuat tabel ' + required);
      }
      const account = check.prepare('SELECT COUNT(*) AS n FROM account').get() as { n?: number } | undefined;
      if (Number(account?.n ?? 0) < 1) throw new BadRequestException('Database backup tidak memuat akun');
    } finally {
      check?.close();
    }
  }

  /**
   * Tukar folder uploads secara atomik. Bila arsip tidak membawa uploads, folder
   * lama sengaja dibiarkan; database baru tetap memakai berkas yang sudah ada.
   */
  private async swapUploads(staged: string | null) {
    const target = this.uploadsDir();
    const old = target + '.restore-old';
    await rm(old, { recursive: true, force: true });
    if (!staged) return { commit: async () => {}, rollback: async () => {} };

    const had = existsSync(target);
    if (had) await rename(target, old);
    try {
      await rename(staged, target);
    } catch (err) {
      if (had) await rename(old, target);
      throw err;
    }
    return {
      commit: async () => {
        await rm(old, { recursive: true, force: true }).catch(() => {});
      },
      rollback: async () => {
        await rm(target, { recursive: true, force: true });
        if (had) await rename(old, target);
      },
    };
  }
}
