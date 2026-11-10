import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;

async function waitHealth(base, tries = 120) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('API tidak siap');
}

function cookieOf(res) {
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
  return raw.split(';')[0];
}

test('alur login, baca berkas, dan tolak path keluar jail', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'st-it-data-'));
  const files = await mkdtemp(join(tmpdir(), 'st-it-files-'));
  const port = 3300 + Math.floor(Math.random() * 200);
  const base = 'http://127.0.0.1:' + port;
  await writeFile(join(files, 'halo.txt'), 'halo dari integrasi\n');

  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: ROOT + 'apps/api',
    env: { ...process.env, ST_PORT: String(port), ST_DATA_DIR: data, ST_FS_ROOTS: files },
    stdio: ['ignore', 'ignore', 'ignore'],
  });

  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(data, { recursive: true, force: true });
    await rm(files, { recursive: true, force: true });
  });

  await waitHealth(base);
  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'password' }),
  });
  assert.equal(login.status, 201);
  let cookie = cookieOf(login);
  assert.ok(cookie.startsWith('st_session='));

  const change = await fetch(base + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-st-csrf': '1' },
    body: JSON.stringify({ current: 'password', next: 'password123' }),
  });
  assert.equal(change.status, 201);
  cookie = cookieOf(change);

  const read = await fetch(base + '/api/fs/read?path=' + encodeURIComponent(join(files, 'halo.txt')), {
    headers: { cookie },
  });
  assert.equal(read.status, 200);
  const file = await read.json();
  assert.equal(file.binary, false);
  assert.match(file.text, /halo dari integrasi/);

  const escaped = await fetch(base + '/api/fs/read?path=' + encodeURIComponent('/etc/passwd'), {
    headers: { cookie },
  });
  assert.ok([400, 403].includes(escaped.status), 'path di luar root harus ditolak');

  const ticket = await fetch(base + '/api/proxy/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-st-csrf': '1' },
    body: JSON.stringify({ origin: 'http://169.254.169.254' }),
  });
  assert.equal(ticket.status, 400, 'alamat metadata harus ditolak');
});
