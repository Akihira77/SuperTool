import { Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { cfg } from '../../config';
import { jailPath } from '../../common/fs-jail';

type ConfFile = { name: string; path: string; size: number; mtime: number };

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
          if (dirent.name === 'sites-enabled' || dirent.name === 'sites-available' || dirent.name === 'conf.d' || dirent.name === 'snippets' || depth === 0) {
            await walk(full, depth + 1);
          }
          continue;
        }
        if (!/\.(conf|bak|disabled)$/.test(dirent.name)) continue;
        try {
          const info = await stat(full);
          files.push({ name: relative(dir, full), path: full, size: info.size, mtime: info.mtimeMs });
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
    if (info.size > 2 * 1024 * 1024) throw new Error('File terlalu besar');
    return { path: abs, text: await readFile(abs, 'utf8'), mtime: info.mtimeMs };
  }

  async write(path: string, content: string) {
    const abs = await jailPath(path, this.roots());
    await writeFile(abs, content, 'utf8');
    return { ok: true, path: abs };
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
