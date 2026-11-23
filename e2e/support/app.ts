import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const REPO = join(__dirname, '../..');
const API_DIR = join(REPO, 'apps/api');
const WEB_DIST = join(REPO, 'apps/web/dist');

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
 * dan port sendiri. Tidak pernah menyentuh data pengguna.
 */
export async function startApp(): Promise<App> {
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error('Build web belum ada. Jalankan `pnpm build` sebelum E2E.');
  }
  const dataDir = await mkdtemp(join(tmpdir(), 'st-e2e-data-'));
  const filesDir = await mkdtemp(join(tmpdir(), 'st-e2e-files-'));
  const tempDir = await mkdtemp(join(tmpdir(), 'st-e2e-tmp-'));
  const port = await freePort();

  const logs: string[] = [];
  const child = spawn(process.execPath, ['dist/main.js'], {
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
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  const baseUrl = `http://127.0.0.1:${port}`;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  let ready = false;
  for (let attempt = 0; attempt < 150 && !ready; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`API berhenti saat start:\n${logs.join('')}`);
    }
    try {
      ready = (await fetch(baseUrl + '/api/health')).ok;
    } catch {
      // belum listen
    }
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error(`API tidak siap dalam 15 detik:\n${logs.join('')}`);

  let stopped = false;
  return {
    baseUrl,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      child.kill('SIGTERM');
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
      await Promise.race([exited, timeout]);
      if (child.exitCode === null) child.kill('SIGKILL');
      await Promise.all([
        rm(dataDir, { recursive: true, force: true }),
        rm(filesDir, { recursive: true, force: true }),
        rm(tempDir, { recursive: true, force: true }),
      ]);
    },
  };
}
