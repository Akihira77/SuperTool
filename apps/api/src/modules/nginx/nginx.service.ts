import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { copyFile, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { cfg } from '../../config';
import { jailPath } from '../../common/fs-jail';

type ConfFile = { name: string; path: string; size: number; mtime: number; hasBackup: boolean };

const TEMPLATE = [
  '# dibuat lewat Super Tool',
  'server {',
  '    listen 80;',
  '    server_name contoh.local;',
  '',
  '    location / {',
  '        proxy_pass http://127.0.0.1:3000;',
  '        proxy_set_header Host $host;',
  '        proxy_set_header X-Real-IP $remote_addr;',
  '    }',
  '}',
  '',
].join('\n');

@Injectable()
export class NginxService {
  private readonly roots = () => [cfg.nginxDir];

  async list(): Promise<{ dir: string; files: ConfFile[] }> {
    const dir = await jailPath(cfg.nginxDir, this.roots());
    const files: ConfFile[] = [];
    const walk = async (current: string, depth: number) => {
      if (depth > 3 || files.length > 500) return;
      let dirents;
      try {
        dirents = await readdir(current, { withFileTypes: true });
      } catch {
        return;
      }
      for (const dirent of dirents) {
        const full = join(current, dirent.name);
        if (dirent.isDirectory()) {
          const interesting = ['sites-enabled', 'sites-available', 'conf.d', 'snippets'];
          if (interesting.includes(dirent.name) || depth === 0) await walk(full, depth + 1);
          continue;
        }
        if (!/\.(conf|bak|disabled)$/.test(dirent.name) || dirent.name.endsWith('.bak')) continue;
        try {
          const info = await stat(full);
          const backup = await stat(full + '.bak').then(
            () => true,
            () => false,
          );
          files.push({ name: relative(dir, full), path: full, size: info.size, mtime: info.mtimeMs, hasBackup: backup });
        } catch {
          // lewati file yang tidak bisa dibaca
        }
      }
    };
    await walk(dir, 0);
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { dir, files };
  }

  async read(path: string) {
    const abs = await jailPath(path, this.roots());
    const info = await stat(abs);
    if (info.size > 2 * 1024 * 1024) throw new BadRequestException('File terlalu besar');
    return { path: abs, text: await readFile(abs, 'utf8'), mtime: info.mtimeMs };
  }

  /** Simpan dengan cadangan otomatis: isi asli disalin ke <file>.bak saat pertama kali diubah. */
  async write(path: string, content: string) {
    const abs = await jailPath(path, this.roots());
    await copyFile(abs, abs + '.bak').catch(() => undefined);
    await writeFile(abs, content, 'utf8');
    return { ok: true, path: abs, hasBackup: true };
  }

  async create(name: string) {
    const clean = basename(String(name ?? '').trim());
    if (!clean || clean !== String(name).trim() || !/\.conf$/.test(clean)) {
      throw new BadRequestException('Nama file harus berakhiran .conf tanpa folder');
    }
    const target = await jailPath(join(cfg.nginxDir, clean), this.roots());
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (exists) throw new BadRequestException('File sudah ada');
    await writeFile(target, TEMPLATE, 'utf8');
    return { ok: true, path: target };
  }

  async remove(path: string) {
    const abs = await jailPath(path, this.roots());
    await rm(abs, { force: true });
    await rm(abs + '.bak', { force: true });
    return { ok: true };
  }

  /** Kembalikan isi file ke cadangan sebelum diedit. */
  async revert(path: string) {
    const abs = await jailPath(path, this.roots());
    const backup = abs + '.bak';
    const info = await stat(backup).catch(() => null);
    if (!info) throw new NotFoundException('Tidak ada cadangan asli untuk file ini');
    const original = await readFile(backup);
    await writeFile(abs, original);
    await rm(backup, { force: true });
    return { ok: true, text: original.toString('utf8') };
  }

  async test(): Promise<{ ok: boolean; output: string }> {
    return new Promise((resolve) => {
      execFile('nginx', ['-t'], { timeout: 15000 }, (err, stdout, stderr) => {
        const output = (stdout || '') + (stderr || '');
        resolve({ ok: !err, output: output.trim() || (err ? String(err.message) : 'OK') });
      });
    });
  }
}
