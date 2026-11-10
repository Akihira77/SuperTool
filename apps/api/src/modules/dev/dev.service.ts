import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { open, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Request, Response } from 'express';
import { cfg } from '../../config';
import { jailPath } from '../../common/fs-jail';
import { requestLocal } from '../../common/http-client';

const exec = promisify(execFile);
const HASHES = new Set(['md5', 'sha1', 'sha256', 'sha512', 'sha3-256', 'sha3-512']);
const MAX_TEXT = 4 * 1024 * 1024;
const DOCKER_ACTIONS = new Set(['start', 'stop', 'restart', 'remove']);
const CONTAINER_REF = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/;

export function dockerActionArgs(action: unknown, id: unknown): string[] {
  const verb = String(action ?? '');
  if (!DOCKER_ACTIONS.has(verb)) throw new BadRequestException('Aksi Docker tidak didukung');
  const ref = String(id ?? '');
  if (!CONTAINER_REF.test(ref)) throw new BadRequestException('ID container tidak valid');
  return verb === 'remove' ? ['rm', '-f', ref] : [verb, ref];
}

@Injectable()
/** Branch hanya boleh nama ref yang aman; tidak pernah diteruskan sebagai opsi git. */
export function safeBranchName(raw: unknown): string {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 80 || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) || name.includes('..') || name.includes('//') || name.endsWith('/') || name.endsWith('.lock')) {
    throw new BadRequestException('Nama branch tidak valid');
  }
  return name;
}

export class DevService {
  hash(input: { text?: string; algo?: string; hmacKey?: string }) {
    const text = String(input?.text ?? '');
    if (text.length > MAX_TEXT) throw new BadRequestException('Teks terlalu besar');
    const algo = String(input?.algo ?? 'sha256').toLowerCase();
    if (!HASHES.has(algo)) throw new BadRequestException('Algoritma tidak didukung');
    const key = String(input?.hmacKey ?? '');
    const digest = key ? createHmac(algo, key).update(text) : createHash(algo).update(text);
    return { algo, hex: digest.digest('hex') };
  }

  async http(input: {
    method?: string;
    url?: string;
    headers?: Array<{ key?: string; value?: string }>;
    body?: string;
    timeoutMs?: number;
  }) {
    const raw = String(input?.url ?? '').trim();
    if (!raw) throw new BadRequestException('URL wajib diisi');
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(raw) ? raw : 'http://' + raw);
    } catch {
      throw new BadRequestException('URL tidak valid');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('Hanya http/https');

    const headers: Record<string, string> = {};
    for (const item of input?.headers ?? []) {
      const key = String(item?.key ?? '').trim();
      if (key) headers[key] = String(item?.value ?? '');
    }
    try {
      const response = await requestLocal(url.href, {
        method: String(input?.method ?? 'GET'),
        headers,
        body: String(input?.body ?? ''),
        timeoutMs: Number(input?.timeoutMs ?? 20_000),
        maxResponseBytes: 1_000_000,
      });
      return {
        status: response.status,
        statusText: response.statusText,
        ms: response.ms,
        size: response.size,
        headers: response.headers,
        body: response.body.toString('utf8'),
        truncated: response.truncated,
        url: response.url,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('Request gagal: ' + (err as Error).message);
    }
  }

  async logs(path: string, lines = 300) {
    const abs = await jailPath(path, [...cfg.logRoots, ...cfg.fsRoots]);
    const info = await stat(abs).catch(() => null);
    if (!info) throw new NotFoundException('Berkas log tidak ditemukan');
    if (!info.isFile()) throw new BadRequestException('Bukan berkas');
    const take = Math.min(4 * 1024 * 1024, info.size);
    const handle = await open(abs, 'r');
    try {
      const buffer = Buffer.alloc(take);
      await handle.read(buffer, 0, take, Math.max(0, info.size - take));
      let text = buffer.toString('utf8');
      if (take < info.size) {
        const cut = text.indexOf('\n');
        text = cut >= 0 ? text.slice(cut + 1) : text;
      }
      const list = text.split('\n');
      const max = Math.min(2000, Math.max(1, Number(lines) || 300));
      return { path: abs, size: info.size, mtime: info.mtimeMs, lines: list.slice(-max) };
    } finally {
      await handle.close();
    }
  }

  /** Streaming log: baris terakhir lalu ekor berkas setiap 500 ms. */
  async streamLogs(path: string, req: Request, res: Response): Promise<void> {
    const abs = await jailPath(path, [...cfg.logRoots, ...cfg.fsRoots]);
    const initial = await this.logs(abs, 200);

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    for (const line of initial.lines) res.write('data: ' + JSON.stringify({ line }) + '\n\n');

    let offset = initial.size;
    let stopped = false;
    const send = (payload: unknown) => {
      if (!stopped) res.write('data: ' + JSON.stringify(payload) + '\n\n');
    };

    const timer = setInterval(async () => {
      try {
        const info = await stat(abs);
        if (info.size < offset) {
          offset = 0;
          send({ reset: true });
        }
        if (info.size === offset) return;
        const from = Math.max(offset, info.size - 1024 * 1024);
        const handle = await open(abs, 'r');
        const buffer = Buffer.alloc(info.size - from);
        await handle.read(buffer, 0, buffer.length, from);
        await handle.close();
        offset = info.size;
        for (const line of buffer.toString('utf8').split('\n')) {
          if (line) send({ line });
        }
      } catch {
        // berkas sementara tidak bisa dibaca: diamkan
      }
    }, 500);

    const stop = () => {
      stopped = true;
      clearInterval(timer);
      res.end();
    };
    req.on('close', stop);
    res.on('close', stop);
  }

  private async docker(args: string[]) {
    try {
      const { stdout } = await exec('docker', args, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      throw new BadRequestException('Docker tidak bisa dipakai: ' + (err as Error).message.slice(0, 200));
    }
  }

  async dockerContainers() {
    const stdout = await this.docker(['ps', '-a', '--no-trunc', '--format', '{{json .}}']);
    const rows = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          const raw = JSON.parse(line) as Record<string, string>;
          return {
            id: raw.ID?.slice(0, 12) ?? '',
            fullId: raw.ID ?? '',
            name: raw.Names ?? '',
            image: raw.Image ?? '',
            state: raw.State ?? '',
            status: raw.Status ?? '',
            ports: raw.Ports ?? '',
            running: String(raw.State ?? '').toLowerCase() === 'running',
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return { rows };
  }

  async dockerImages() {
    const stdout = await this.docker(['images', '--format', '{{json .}}']);
    const rows = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          const raw = JSON.parse(line) as Record<string, string>;
          return {
            repo: raw.Repository,
            tag: raw.Tag,
            size: raw.Size,
            created: raw.CreatedSince ?? raw.Created,
            createdAt: raw.CreatedAt ?? '',
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    return { rows };
  }

  async dockerLogs(id: string) {
    if (!CONTAINER_REF.test(String(id ?? ''))) throw new BadRequestException('ID container tidak valid');
    const stdout = await this.docker(['logs', '--tail', '300', id]);
    return { text: stdout };
  }

  async dockerAction(action: string, id: string) {
    const args = dockerActionArgs(action, id);
    const output = await this.docker(args);
    return { ok: true, action, output: output.trim() };
  }

  // ---------- cron ----------

  private async cronRaw(): Promise<string> {
    try {
      const { stdout } = await exec('crontab', ['-l'], { timeout: 10_000 });
      return stdout;
    } catch {
      return '';
    }
  }

  async cronList() {
    const raw = await this.cronRaw();
    const entries = raw
      .split('\n')
      .map((line, index) => ({ line, index }))
      .filter((item) => item.line.trim() && !item.line.trim().startsWith('#'))
      .map((item) => ({ index: item.index, line: item.line }));
    return { entries, raw };
  }

  async cronAdd(line: string) {
    const entry = String(line ?? '').trim();
    if (!entry) throw new BadRequestException('Baris cron kosong');
    if (/[\r\n]/.test(entry) || entry.length > 500) throw new BadRequestException('Baris cron tidak valid');
    const current = await this.cronRaw();
    const next = current.trim() ? current.replace(/\n*$/, '\n') + entry + '\n' : entry + '\n';
    await this.cronWrite(next);
    return this.cronList();
  }

  async cronRemove(index: number) {
    const raw = await this.cronRaw();
    const lines = raw.split('\n');
    const target = Number(index);
    if (!Number.isInteger(target) || target < 0 || target >= lines.length) {
      throw new BadRequestException('Baris tidak ditemukan');
    }
    lines.splice(target, 1);
    await this.cronWrite(lines.join('\n'));
    return this.cronList();
  }

  private async cronWrite(content: string): Promise<void> {
    const file = join(cfg.dataDir, 'crontab.tmp');
    await writeFile(file, content, 'utf8');
    try {
      await exec('crontab', [file], { timeout: 10_000 });
    } catch (err) {
      throw new BadRequestException('Gagal menulis crontab: ' + (err as Error).message.slice(0, 120));
    }
  }

  // ---------- DNS ----------

  private geoCache = new Map<string, { at: number; data: unknown }>();

  async dnsLookup(host: string) {
    const name = String(host ?? '').trim().toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(name) || name.length < 3 || name.length > 253) {
      throw new BadRequestException('Nama domain tidak valid');
    }
    const [a, aaaa, mx, cname, ns, txt] = await Promise.all([
      dns.resolve4(name).catch(() => [] as string[]),
      dns.resolve6(name).catch(() => [] as string[]),
      dns.resolveMx(name).catch(() => [] as Array<{ exchange: string; priority: number }>),
      dns.resolveCname(name).catch(() => [] as string[]),
      dns.resolveNs(name).catch(() => [] as string[]),
      dns.resolveTxt(name).catch(() => [] as string[][]),
    ]);

    const geo = a.length ? await this.geo(a[0]) : null;
    return {
      host: name,
      a,
      aaaa,
      mx: mx.map((item) => (item.exchange ? item.exchange + ' (' + item.priority + ')' : '(null MX — domain tidak menerima email)')),
      cname,
      ns,
      txt: txt.map((chunk) => chunk.join('')),
      geo,
    };
  }

  private async geo(ip: string) {
    const cached = this.geoCache.get(ip);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
    try {
      const response = await fetch(
        'http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=status,country,regionName,city,isp,org,timezone,lat,lon,query',
        { signal: AbortSignal.timeout(6000) },
      );
      const data = await response.json();
      this.geoCache.set(ip, { at: Date.now(), data });
      return data;
    } catch {
      return null;
    }
  }

  private async gitExec(abs: string, args: string[], maxBuffer = 8 * 1024 * 1024) {
    const { stdout } = await exec('git', ['-C', abs, ...args], { timeout: 20_000, maxBuffer });
    return stdout;
  }

  async git(path: string, ref?: string) {
    const abs = await jailPath(path);
    const wanted = String(ref ?? '').trim();
    const run = (args: string[]) => this.gitExec(abs, args);
    try {
      await run(['rev-parse', '--git-dir']);
    } catch {
      throw new BadRequestException('Folder ini bukan repositori git');
    }

    const [branch, status, log, diffstat, tags, branches, graph] = await Promise.all([
      run(['branch', '--show-current']).catch(() => ''),
      run(['status', '--porcelain=v1', '-uall']).catch(() => ''),
      // Riwayat commit untuk grafik: hash, parent, penulis, dekorasi branch.
      (wanted
        ? run(['log', '-60', '--pretty=%H%x1f%P%x1f%h%x1f%an%x1f%ae%x1f%ar%x1f%D%x1f%s', wanted])
        : run(['log', '--all', '-60', '--pretty=%H%x1f%P%x1f%h%x1f%an%x1f%ae%x1f%ar%x1f%D%x1f%s'])
      ).catch(() => ''),
      run(['diff', '--stat=100']).catch(() => ''),
      run(['tag', '--sort=-creatordate']).catch(() => ''),
      run(['branch', '--format=%(refname:short)']).catch(() => ''),
      // Grafik commit: semua branch (atau satu ref kalau dipilih).
      (wanted
        ? run(['log', '--graph', '--oneline', '--decorate', '-40', wanted])
        : run(['log', '--graph', '--oneline', '--decorate', '--all', '-40'])
      ).catch(() => ''),
    ]);

    const stashRaw = await run(['stash', 'list', '--format=%gd%x1f%gs']).catch(() => '');
    const stashes = stashRaw
      .split('\n')
      .filter(Boolean)
      .slice(0, 30)
      .map((line) => {
        const [ref, message] = line.split('\x1f');
        return { ref, message: message ?? '' };
      });

    let ahead = 0;
    let behind = 0;
    try {
      const counts = (await run(['rev-list', '--left-right', '--count', '@{u}...HEAD'])).trim().split(/\s+/);
      behind = Number(counts[0] ?? 0);
      ahead = Number(counts[1] ?? 0);
    } catch {
      // tidak ada upstream
    }

    // status per berkas: { status: 'M', path, }
    const staged: Array<{ status: string; path: string }> = [];
    const changed: Array<{ status: string; path: string }> = [];
    const untracked: Array<{ status: string; path: string }> = [];
    for (const line of status.split('\n').filter(Boolean)) {
      const code = line.slice(0, 2);
      const file = line.slice(3);
      if (code === '??') untracked.push({ status: '?', path: file });
      else if (code[0] !== ' ' && code[0] !== '?') staged.push({ status: code.trim() || 'M', path: file });
      else changed.push({ status: (code[1] ?? 'M').trim() || 'M', path: file });
    }

    return {
      path: abs,
      branch: branch.trim() || '(detached)',
      ahead,
      behind,
      stashes,
      staged,
      changed,
      untracked,
      log: log
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [hash, parents, short, author, email, when, refs, subject] = line.split('\x1f');
          return {
            hash,
            short: short ?? hash.slice(0, 7),
            parents: (parents ?? '').split(' ').filter(Boolean),
            author,
            email,
            when,
            subject,
            refs: (refs ?? '')
              .split(',')
              .map((item) => item.trim().replace(/^HEAD -> /, '').replace(/^tag: /, ''))
              .filter(Boolean),
          };
        }),
      diffstat: diffstat.trim(),
      tags: tags.split('\n').filter(Boolean).slice(0, 5),
      ref: wanted || null,
      branches: branches.split('\n').filter(Boolean).slice(0, 30),
      graph: graph.replace(/\s+$/g, ''),
      head: branch.trim() || null,
    };
  }

  /** Stage / unstage berkas dari panel status. */
  async gitStage(path: string, files: string[], action: string) {
    const abs = await jailPath(path);
    const list = files.filter(Boolean).slice(0, 200);
    if (!list.length) throw new BadRequestException('Tidak ada berkas dipilih');
    const args = action === 'unstage' ? ['restore', '--staged', '--', ...list] : ['add', '--', ...list];
    try {
      await this.gitExec(abs, args);
    } catch (err) {
      throw new BadRequestException('Git gagal: ' + (err as Error).message.slice(0, 160));
    }
    return { ok: true, files: list.length, action: action === 'unstage' ? 'unstage' : 'stage' };
  }

  /** Diff satu berkas (working tree atau staged). */
  async gitDiff(path: string, file: string, staged = false) {
    const abs = await jailPath(path);
    const args = ['diff', ...(staged ? ['--cached'] : []), '--', file];
    try {
      return { diff: await this.gitExec(abs, args, 4 * 1024 * 1024) };
    } catch (err) {
      throw new BadRequestException('Git gagal: ' + (err as Error).message.slice(0, 160));
    }
  }

  /** Patch satu commit. */
  async gitBranch(path: string, action: string, rawName: string): Promise<{ ok: true; action: string; branch: string }> {
    const abs = await jailPath(path);
    const name = safeBranchName(rawName);
    const verb = action === 'create' ? ['switch', '-c', name] : action === 'switch' ? ['switch', name] : null;
    if (!verb) throw new BadRequestException('Aksi branch harus create atau switch');
    try {
      await this.gitExec(abs, verb);
      return { ok: true, action, branch: name };
    } catch (err) {
      throw new BadRequestException('Git gagal: ' + (err as Error).message.slice(0, 160));
    }
  }

  async gitCommit(path: string, rawMessage: unknown): Promise<{ ok: true; hash: string }> {
    const abs = await jailPath(path);
    const message = String(rawMessage ?? '').trim();
    if (!message || message.length > 2000 || message.includes('\u0000')) throw new BadRequestException('Pesan commit wajib diisi (maks 2000 karakter)');
    try {
      await this.gitExec(abs, ['commit', '-m', message]);
      return { ok: true, hash: (await this.gitExec(abs, ['rev-parse', '--short', 'HEAD'])).trim() };
    } catch (err) {
      throw new BadRequestException('Git gagal: ' + (err as Error).message.slice(0, 200));
    }
  }

  async gitStash(path: string, action: string, indexInput?: string | number, rawMessage?: unknown): Promise<{ ok: true; action: string; output: string }> {
    const abs = await jailPath(path);
    if (action === 'save') {
      const message = String(rawMessage ?? '').trim().slice(0, 200);
      const args = message ? ['stash', 'push', '-m', message] : ['stash', 'push'];
      const output = await this.gitExec(abs, args);
      return { ok: true, action, output: output.trim() };
    }
    if (action === 'pop' || action === 'drop') {
      const index = Number(indexInput ?? 0);
      if (!Number.isInteger(index) || index < 0 || index > 99) throw new BadRequestException('Indeks stash tidak valid');
      const output = await this.gitExec(abs, ['stash', action, 'stash@{' + index + '}']);
      return { ok: true, action, output: output.trim() };
    }
    throw new BadRequestException('Aksi stash harus save, pop, atau drop');
  }

  async gitShow(path: string, hash: string) {
    const abs = await jailPath(path);
    if (!/^[0-9a-f]{4,40}$/i.test(hash)) throw new BadRequestException('Hash tidak valid');
    try {
      return { diff: await this.gitExec(abs, ['show', '--format=', '--patch', hash], 4 * 1024 * 1024) };
    } catch (err) {
      throw new BadRequestException('Git gagal: ' + (err as Error).message.slice(0, 160));
    }
  }
}
