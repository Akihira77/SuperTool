import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPO = join(__dirname, '../..');
const API_DIR = join(REPO, 'apps/api');
const WEB_DIST = join(REPO, 'apps/web/dist');

const START_TIMEOUT_MS = 15_000;
const TERM_TIMEOUT_MS = 5_000;
const KILL_TIMEOUT_MS = 5_000;

export type App = { baseUrl: string; stop: () => Promise<void> };
export type Upstream = { origin: string; stop: () => Promise<void> };

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const MOCK_PAGES: Record<string, { type: string; body: string }> = {
  '/': {
    type: 'text/html; charset=utf-8',
    body: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Mock upstream</title></head>
  <body>
    <main>
      <h1>MOCK-UPSTREAM-OK</h1>
      <p id="mock-body">konten dari upstream lokal</p>
      <a href="/health">health</a>
    </main>
  </body>
</html>`,
  },
  '/health': { type: 'application/json', body: JSON.stringify({ ok: true }) },
};

/** Upstream lokal untuk menguji proxy; tanpa internet dan tanpa script eksternal. */
export async function startMockUpstream(): Promise<Upstream> {
  const port = await freePort();
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const page = MOCK_PAGES[path];
    res.writeHead(page ? 200 : 404, { 'content-type': page?.type ?? 'text/plain; charset=utf-8' });
    res.end(page?.body ?? 'not found');
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tunggu event `exit`, tapi jangan menggantung kalau proses tidak pernah di-reap. */
async function waitExit(exited: Promise<void>, ms: number): Promise<boolean> {
  return Promise.race([exited.then(() => true), delay(ms).then(() => false)]);
}

/**
 * SIGTERM lalu tunggu exit; kalau melewati batas, SIGKILL lalu tunggu exit lagi.
 * Direktori baru dihapus setelah proses benar-benar keluar.
 */
async function terminate(child: ChildProcess, exited: Promise<void>, spawned: () => boolean): Promise<void> {
  if (!spawned()) return;
  if (child.exitCode !== null || child.signalCode !== null) {
    await waitExit(exited, KILL_TIMEOUT_MS);
    return;
  }
  child.kill('SIGTERM');
  if (await waitExit(exited, TERM_TIMEOUT_MS)) return;
  child.kill('SIGKILL');
  await waitExit(exited, KILL_TIMEOUT_MS);
}

/**
 * Jalankan API produksi (static web + api satu origin) dengan data, files root,
 * dan port sendiri. Tidak pernah menyentuh data pengguna. Semua direktori
 * sementara dibersihkan pada jalur sukses maupun gagal start.
 */
export async function startApp(): Promise<App> {
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error('Build web belum ada. Jalankan `pnpm build` sebelum E2E.');
  }

  const dirs: string[] = [];
  const makeDir = async (prefix: string) => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
  };
  const dataDir = await makeDir('st-e2e-data-');
  const filesDir = await makeDir('st-e2e-files-');
  const tempDir = await makeDir('st-e2e-tmp-');
  const port = await freePort();

  // Idempoten: aman dipanggil dari jalur gagal start, stop normal, dan stop ganda.
  const cleanupDirs = async () => {
    const pending = dirs.splice(0);
    const results = await Promise.allSettled(pending.map((dir) => rm(dir, { recursive: true, force: true })));
    const failed = results.find((result) => result.status === 'rejected');
    if (failed) throw failed.reason;
  };

  const logs: string[] = [];
  let child: ChildProcess;
  try {
    child = spawn(process.execPath, ['dist/main.js'], {
      cwd: API_DIR,
      env: {
        ...process.env,
        ST_PORT: String(port),
        ST_HOST: '127.0.0.1',
        ST_DATA_DIR: dataDir,
        ST_FS_ROOTS: filesDir,
        ST_TEMP_DIR: tempDir,
        ST_WEB_DIST: WEB_DIST,
        ST_LOG_ROOTS: '',
        ST_PROXY_ALLOW_PUBLIC: '',
        ST_LLM_BASE_URL: '',
        GOOGLE_CLIENT_ID: '',
        GOOGLE_CLIENT_SECRET: '',
        TELEGRAM_BOT_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    await cleanupDirs().catch(() => undefined);
    throw error;
  }

  let spawned = false;
  let spawnError: Error | null = null;
  child.once('spawn', () => {
    spawned = true;
  });
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    try {
      await terminate(child, exited, () => spawned);
    } finally {
      await cleanupDirs();
    }
  };

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error('API berhenti saat start');
      }
      try {
        if ((await fetch(baseUrl + '/api/health')).ok) break;
      } catch {
        // belum listen
      }
      if (Date.now() > deadline) throw new Error('API tidak siap dalam 15 detik');
      await delay(100);
    }
  } catch (error) {
    await stop().catch(() => undefined);
    const detail = logs.join('').slice(-4000);
    throw new Error(`Gagal start API: ${(error as Error).message}\n${detail}`);
  }

  return { baseUrl, stop };
}
