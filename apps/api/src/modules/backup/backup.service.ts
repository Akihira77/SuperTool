import { BadRequestException, Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ZipArchive } from 'archiver';
import type { Response } from 'express';
import { cfg } from '../../config';
import { db, replaceDatabase } from '../../common/db';

const exec = promisify(execFile);

const DB_NAME = 'super-tool.db';
const UPLOADS = 'uploads';
const MAX_UPLOAD = 100 * 1024 * 1024;
const MAX_UNZIPPED = 1024 * 1024 * 1024;
const MAX_DB = 512 * 1024 * 1024;
const MAX_ENTRIES = 3000;

type Uploaded = { originalname: string; buffer: Buffer; size: number };

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
    if (!file?.buffer?.length) throw new BadRequestException('File .zip tidak ditemukan');
    if (file.size > MAX_UPLOAD) throw new BadRequestException('File backup maksimal 100 MB');
    if (!/\.zip$/i.test(file.originalname || '')) throw new BadRequestException('File harus berakhiran .zip');

    const temp = await mkdtemp(join(tmpdir(), 'st-restore-'));
    try {
      const zipPath = join(temp, 'upload.zip');
      await writeFile(zipPath, file.buffer);

      const names = await this.listZip(zipPath);
      if (!names.length) throw new BadRequestException('Arsip kosong');
      if (names.length > MAX_ENTRIES) throw new BadRequestException('Arsip berisi terlalu banyak berkas');
      for (const name of names) this.assertSafe(name);

      if (!names.includes(DB_NAME)) throw new BadRequestException('Backup tidak memuat ' + DB_NAME);

      const total = await this.unzippedSize(zipPath);
      if (total > MAX_UNZIPPED) throw new BadRequestException('Isi arsip terlalu besar (maks 1 GB)');

      const out = join(temp, 'out');
      await mkdir(out, { recursive: true });
      await exec('unzip', ['-o', '-q', zipPath, DB_NAME, '-d', out]);
      const dbFile = join(out, DB_NAME);
      const info = await stat(dbFile);
      if (!info.isFile() || info.size < 512) throw new BadRequestException('File database di dalam backup tidak valid');
      if (info.size > MAX_DB) throw new BadRequestException('Database backup terlalu besar');

      const head = await readFile(dbFile);
      if (head.subarray(0, 16).toString('utf8') !== 'SQLite format 3\u0000') {
        throw new BadRequestException('File database bukan SQLite yang valid');
      }

      const hasUploads = names.some((name) => name === UPLOADS + '/' || name.startsWith(UPLOADS + '/'));
      if (hasUploads) {
        await exec('unzip', ['-o', '-q', zipPath, UPLOADS + '/*', '-d', out]);
        const restored = join(out, UPLOADS);
        if (existsSync(restored)) {
          const target = this.uploadsDir();
          await rm(target, { recursive: true, force: true });
          // cp, bukan rename: /tmp dan folder data bisa beda filesystem (EXDEV).
          await cp(restored, target, { recursive: true });
        }
      }

      replaceDatabase(dbFile);
      return { ok: true, size: info.size, uploads: hasUploads, revoked: true, at: Date.now() };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const message = (err as Error).message ?? '';
      if (message.includes('ENOENT') && message.includes('unzip')) {
        throw new BadRequestException('Perintah unzip tidak tersedia di server');
      }
      throw new BadRequestException('Gagal memulihkan backup: ' + message.slice(0, 160));
    } finally {
      await rm(temp, { recursive: true, force: true });
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
}
