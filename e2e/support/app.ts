import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  combineErrors,
  createIdempotent,
  createTempDirs,
  delay,
  shutdownProcess,
  type SpawnOutcome,
} from './lifecycle';

export const REPO = join(__dirname, '../..');
const API_DIR = join(REPO, 'apps/api');
const WEB_DIST = join(REPO, 'apps/web/dist');

const START_TIMEOUT_MS = 15_000;

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

/**
 * Jalankan API produksi (static web + api satu origin) dengan data, files root,
 * dan port sendiri. Tidak pernah menyentuh data pengguna. Semua direktori
 * sementara dibersihkan pada jalur sukses maupun gagal start; kalau proses
 * belum dipastikan berhenti, direktori dipertahankan dan error dilaporkan.
 */
export async function startApp(): Promise<App> {
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error('Build web belum ada. Jalankan `pnpm build` sebelum E2E.');
  }

  const { dirs, cleanup } = await createTempDirs(
    (prefix) => mkdtemp(join(tmpdir(), prefix)),
    ['st-e2e-data-', 'st-e2e-files-', 'st-e2e-tmp-'],
    (dir) => rm(dir, { recursive: true, force: true }),
  );
  const [dataDir, filesDir, tempDir] = dirs;
  const port = await freePort();

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
    const cleanupError = await cleanup().then(
      () => null,
      (reason: unknown) => reason,
    );
    throw combineErrors(error, cleanupError);
  }

  let spawnError: Error | null = null;
  const spawnSettled = new Promise<SpawnOutcome>((resolve) => {
    child.once('spawn', () => resolve('spawn'));
    child.once('error', () => resolve('error'));
  });
  child.on('error', (error) => {
    spawnError = error;
  });
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));

  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  /**
   * Idempoten: panggilan kedua menerima promise yang sama, termasuk rejection.
   * Direktori hanya dihapus setelah proses dipastikan berhenti.
   */
  const stop = createIdempotent(async () => {
    const terminateError = await shutdownProcess({
      process: child,
      exited,
      spawnSettled,
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    if (terminateError) {
      throw combineErrors(
        terminateError,
        new Error(`Direktori sementara dipertahankan karena proses belum dipastikan berhenti: ${dirs.join(', ')}`),
      );
    }
    await cleanup();
  });

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
  } catch (reason) {
    const detail = logs.join('').slice(-4000);
    const startupError = new Error(`Gagal start API: ${(reason as Error).message}\n${detail}`);
    const cleanupError = await stop().then(
      () => null,
      (cleanupReason: unknown) => cleanupReason,
    );
    throw combineErrors(startupError, cleanupError);
  }

  return { baseUrl, stop };
}
