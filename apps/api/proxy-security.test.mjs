import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import headersPolicy from './dist/modules/proxy/proxy-headers.js';
import proxyMiddleware from './dist/modules/proxy/proxy.middleware.js';
import httpClient from './dist/common/http-client.js';
import bodyIdle from './dist/common/body-idle.js';

const ROOT = new URL('../..', import.meta.url).pathname;
const { stripCredentialCookies, upstreamHttpHeaders, upstreamUpgradeHeaders, SANDBOX_CSP } = headersPolicy;
const { bodyIdleMs, bodyIdleGuard } = bodyIdle;

test('header policy: cookie credential dibuang, cookie target dipertahankan', () => {
  assert.equal(stripCredentialCookies('st_session=abc; target=1; st_proxy=xyz'), 'target=1');
  assert.equal(stripCredentialCookies('st_session=abc'), undefined);
  assert.equal(stripCredentialCookies(undefined), undefined);
});

test('header policy: request HTTP tidak membawa credential Super Tool', () => {
  const out = upstreamHttpHeaders({
    cookie: 'st_session=abc; st_proxy=xyz; target=1',
    authorization: 'Bearer secret',
    'proxy-authorization': 'Basic secret',
    'x-st-csrf': '1',
    'x-custom': 'keep',
    accept: 'application/json',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'sec-fetch-site': 'same-origin',
    connection: 'keep-alive',
    upgrade: 'websocket',
    'content-length': '5',
  });
  assert.equal(out.cookie, 'target=1');
  assert.equal(out['x-custom'], 'keep');
  assert.equal(out.accept, 'application/json');
  for (const key of ['authorization', 'proxy-authorization', 'x-st-csrf', 'sec-websocket-key', 'sec-fetch-site', 'connection', 'upgrade', 'content-length', 'host', 'origin', 'referer']) {
    assert.equal(out[key], undefined, key + ' tidak boleh diteruskan');
  }
});

test('header policy: handshake WS mempertahankan header protokol, tanpa credential', () => {
  const out = upstreamUpgradeHeaders({
    cookie: 'st_session=abc; st_proxy=xyz; target=1',
    authorization: 'Bearer secret',
    'proxy-authorization': 'Basic secret',
    'x-st-csrf': '1',
    host: 'app.localhost:3001',
    origin: 'http://app.localhost:3001',
    referer: 'http://app.localhost:3001/',
    connection: 'Upgrade',
    upgrade: 'websocket',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'sec-websocket-version': '13',
    'sec-websocket-protocol': 'vite-hmr',
    'sec-websocket-accept': 'bogus',
    'content-length': '0',
  });
  assert.equal(out.connection, 'Upgrade');
  assert.equal(out.upgrade, 'websocket');
  assert.equal(out['sec-websocket-key'], 'dGhlIHNhbXBsZSBub25jZQ==');
  assert.equal(out['sec-websocket-version'], '13');
  assert.equal(out['sec-websocket-protocol'], 'vite-hmr');
  assert.equal(out.cookie, 'target=1');
  for (const key of ['authorization', 'proxy-authorization', 'x-st-csrf', 'host', 'origin', 'referer', 'sec-websocket-accept', 'content-length']) {
    assert.equal(out[key], undefined, key + ' tidak boleh diteruskan');
  }
});

test('header policy: header yang dinominasikan Connection dibuang (HTTP)', () => {
  const out = upstreamHttpHeaders({
    connection: 'keep-alive, X-Internal-Metadata, x-second',
    'x-internal-metadata': 'rahasia',
    'x-second': 'rahasia',
    'x-keep': 'boleh',
    forwarded: 'for=1.2.3.4',
    'x-forwarded-for': '9.9.9.9',
    'x-forwarded-host': 'evil.test',
    'x-forwarded-proto': 'https',
    'x-forwarded-port': '443',
    'x-real-ip': '8.8.8.8',
    accept: 'application/json',
  });
  assert.equal(out['x-internal-metadata'], undefined);
  assert.equal(out['x-second'], undefined);
  assert.equal(out['x-keep'], 'boleh');
  assert.equal(out.accept, 'application/json');
  for (const key of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-real-ip']) {
    assert.equal(out[key], undefined, key + ' tidak boleh diteruskan');
  }
});

test('header policy: token Connection duplikat dan malformed diabaikan dengan aman', () => {
  const out = upstreamHttpHeaders({
    connection: 'X-Drop, x-drop, , bad token, X:Drop',
    'x-drop': 'rahasia',
    'x-ok': 'boleh',
    'x-second': 'boleh',
  });
  assert.equal(out['x-drop'], undefined, 'token duplikat/mixed-case tetap dihapus');
  assert.equal(out['x-ok'], 'boleh', 'token malformed tidak menghapus header lain');
  assert.equal(out['x-second'], 'boleh');
});

test('header policy: WS tetap mempertahankan handshake walau dinominasikan Connection', () => {
  const out = upstreamUpgradeHeaders({
    connection: 'Upgrade, X-Drop, Sec-WebSocket-Key',
    upgrade: 'websocket',
    'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'sec-websocket-version': '13',
    'x-drop': 'rahasia',
    'x-keep': 'boleh',
  });
  assert.equal(out.connection, 'Upgrade', 'Connection dinormalisasi, token client dibuang');
  assert.equal(out.upgrade, 'websocket');
  assert.equal(out['sec-websocket-key'], 'dGhlIHNhbXBsZSBub25jZQ==');
  assert.equal(out['sec-websocket-version'], '13');
  assert.equal(out['x-drop'], undefined);
  assert.equal(out['x-keep'], 'boleh');
});

function fakeDuplex() {
  const chunks = [];
  const stream = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      if (chunk?.length) chunks.push(chunk.toString());
      cb();
    },
  });
  stream.chunks = chunks;
  return stream;
}

function stubAuth(access = 'ok', ticketOk = true) {
  return {
    proxyAccess: async () => access,
    verifyProxyTicket: async (ticket) => Boolean(ticket) && ticketOk,
  };
}

async function settle() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

test('DNS pinning WS: connect memakai alamat hasil validasi, bukan hasil resolver kedua', async () => {
  const token = Buffer.from('http://127.0.0.1:8080', 'utf8').toString('base64url');
  const connects = [];
  const ups = [];
  const calls = [];
  const req = {
    url: '/api/proxy/b/' + token + '/socket',
    method: 'GET',
    headers: {
      connection: 'Upgrade',
      upgrade: 'websocket',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
      cookie: 'st_session=bocor; target=1',
    },
  };
  proxyMiddleware.handleProxyUpgrade(req, fakeDuplex(), Buffer.alloc(0), stubAuth(), {
    resolve: async (url) => {
      calls.push(String(url));
      return { address: '10.1.2.3', family: 4 };
    },
    connect: (options, listener) => {
      connects.push(options);
      const upstream = fakeDuplex();
      ups.push(upstream);
      setImmediate(listener);
      return upstream;
    },
  });
  await settle();
  assert.equal(calls.length, 1, 'resolver hanya dipanggil sekali');
  assert.deepEqual(connects[0], { host: '10.1.2.3', family: 4, port: 8080 });
  const handshake = ups[0].chunks.join('');
  assert.match(handshake, /GET \/socket HTTP\/1\.1/);
  assert.match(handshake, /sec-websocket-key: dGhlIHNhbXBsZSBub25jZQ==/);
  assert.doesNotMatch(handshake, /st_session|bocor/);
});

test('DNS pinning WS: alamat metadata ditolak sebelum connection factory', async () => {
  const token = Buffer.from('http://169.254.169.254', 'utf8').toString('base64url');
  const connects = [];
  const req = { url: '/api/proxy/b/' + token + '/socket', method: 'GET', headers: { connection: 'Upgrade', upgrade: 'websocket' } };
  const socket = fakeDuplex();
  proxyMiddleware.handleProxyUpgrade(req, socket, Buffer.alloc(0), stubAuth(), {
    resolve: async () => {
      throw new Error('Alamat metadata cloud diblokir');
    },
    connect: (options) => {
      connects.push(options);
      return fakeDuplex();
    },
  });
  await settle();
  assert.equal(connects.length, 0, 'koneksi tidak boleh dibuat');
  assert.match(socket.chunks.join(''), /403 Forbidden/);
});

test('DNS pinning WS: family IPv6 dipertahankan', async () => {
  const token = Buffer.from('http://[fd00::5]:9000', 'utf8').toString('base64url');
  const connects = [];
  const req = { url: '/api/proxy/b/' + token + '/socket', method: 'GET', headers: { connection: 'Upgrade', upgrade: 'websocket' } };
  proxyMiddleware.handleProxyUpgrade(req, fakeDuplex(), Buffer.alloc(0), stubAuth(), {
    resolve: async () => ({ address: 'fd00::5', family: 6 }),
    connect: (options, listener) => {
      connects.push(options);
      const upstream = fakeDuplex();
      setImmediate(listener);
      return upstream;
    },
  });
  await settle();
  assert.deepEqual(connects[0], { host: 'fd00::5', family: 6, port: 9000 });
});

test('DNS pinning HTTP: request memakai hostname hasil validasi dan lookup yang dipin', async () => {
  const calls = [];
  const pending = httpClient.streamLocal(
    'http://rebind.test/echo',
    {},
    {
      resolve: async () => ({ address: '192.168.1.9', family: 4 }),
      request: (options) => {
        calls.push(options);
        const req = new EventEmitter();
        req.setTimeout = () => {};
        req.end = () => {};
        req.destroy = () => {};
        return req;
      },
    },
  );
  void pending.catch(() => undefined);
  await settle();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hostname, '192.168.1.9', 'koneksi memakai alamat tervalidasi');
  assert.equal(calls[0].family, 4);
  const pinned = await new Promise((resolve) => calls[0].lookup('rebind.test', {}, (_err, address, family) => resolve({ address, family })));
  assert.deepEqual(pinned, { address: '192.168.1.9', family: 4 }, 'lookup kedua tidak bisa memilih alamat lain');
});

test('DNS pinning HTTP: alamat yang ditolak tidak pernah sampai ke connection factory', async () => {
  const calls = [];
  await assert.rejects(
    httpClient.streamLocal(
      'http://169.254.169.254/',
      {},
      {
        resolve: async () => {
          throw new Error('Alamat metadata cloud diblokir');
        },
        request: (options) => {
          calls.push(options);
          return new EventEmitter();
        },
      },
    ),
    /metadata/,
  );
  assert.equal(calls.length, 0);
});

test('body idle: nilai env tak wajar jatuh ke default, 0 tetap nonaktif', () => {
  assert.equal(bodyIdleMs(undefined), 120_000);
  assert.equal(bodyIdleMs(''), 120_000);
  assert.equal(bodyIdleMs('abc'), 120_000);
  assert.equal(bodyIdleMs('NaN'), 120_000);
  assert.equal(bodyIdleMs('0'), 0);
  assert.equal(bodyIdleMs('-5'), 0);
  assert.equal(bodyIdleMs('250'), 250);
  assert.equal(bodyIdleMs('999999999999'), 60 * 60 * 1000);
});

/** Baca satu respons HTTP kecil dari socket keep-alive. */
function httpExchange(socket, payload) {
  return new Promise((resolve, reject) => {
    let data = '';
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);
    };
    const onData = (chunk) => {
      data += chunk.toString('utf8');
      const split = data.indexOf('\r\n\r\n');
      if (split < 0) return;
      const head = data.slice(0, split);
      const match = /content-length:\s*(\d+)/i.exec(head);
      const need = split + 4 + (match ? Number(match[1]) : 0);
      if (data.length < need) return;
      cleanup();
      resolve(data);
    };
    const onClose = () => {
      cleanup();
      resolve(data);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('respons HTTP tidak lengkap'));
    }, 3000);
    socket.on('data', onData);
    socket.once('close', onClose);
    socket.write(payload);
  });
}

test('body idle: listener timeout bersih di keep-alive dan semua jalur cleanup', async (t) => {
  const serverSockets = [];
  const clients = [];
  const server = http.createServer((req, res) => {
    bodyIdleGuard(150)(req, res, () => {
      if (req.url === '/early') {
        res.destroy();
        return;
      }
      req.resume();
      req.on('end', () => res.end('ok'));
    });
  });
  server.on('connection', (socket) => serverSockets.push(socket));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  t.after(async () => {
    for (const client of clients) client.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  const bodied = (path) =>
    'POST ' + path + ' HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + port + '\r\n' +
    'Content-Type: application/json\r\n' +
    'Content-Length: 2\r\n' +
    'Connection: keep-alive\r\n\r\n' +
    '{}';

  const socket = await openSocket(port);
  clients.push(socket);
  // Node http server sendiri bisa memasang listener 'timeout'; yang penting
  // jumlahnya tidak bertambah oleh middleware.
  const baseline = serverSockets[0].listenerCount('timeout');

  // A: beberapa request bodied berurutan tidak menumpuk listener.
  for (let i = 0; i < 5; i += 1) {
    const reply = await httpExchange(socket, bodied('/x'));
    assert.match(reply, /HTTP\/1\.1 200/);
    assert.equal(serverSockets[0].listenerCount('timeout'), baseline, 'listener tidak menumpuk pada request #' + (i + 1));
  }

  // C: cleanup berulang (end lalu finish) tidak boleh menyisakan callback yang
  // memutus koneksi pada request berikutnya setelah idle terlampaui.
  await sleep(400);
  const afterIdle = await httpExchange(socket, bodied('/x'));
  assert.match(afterIdle, /HTTP\/1\.1 200/, 'koneksi tetap hidup setelah idle');
  assert.equal(serverSockets[0].listenerCount('timeout'), baseline);

  // B: timeout tetap berfungsi di koneksi yang sama setelah request normal.
  const closedAt = await new Promise((resolve) => {
    const start = Date.now();
    socket.once('close', () => resolve(Date.now() - start));
    socket.write(
      'POST /stall HTTP/1.1\r\n' +
        'Host: 127.0.0.1:' + port + '\r\n' +
        'Content-Type: application/json\r\n' +
        'Content-Length: 100\r\n' +
        'Connection: keep-alive\r\n\r\n' +
        '{"a":',
    );
  });
  assert.ok(closedAt >= 100 && closedAt < 1000, 'body macet harus ditutup, closedAt=' + closedAt);
  assert.equal(serverSockets[0].listenerCount('timeout'), baseline, 'listener bersih setelah timeout');

  // C: abort/disconnect client.
  const aborted = await openSocket(port);
  clients.push(aborted);
  aborted.write('POST /x HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nContent-Length: 100\r\n\r\n{"a":');
  await sleep(50);
  aborted.destroy();
  await sleep(100);
  assert.equal(serverSockets[1].listenerCount('timeout'), baseline, 'listener bersih setelah client memutus');
  assert.equal(serverSockets[1].destroyed, true, 'socket server ikut tertutup');

  // C: response ditutup paksa (close tanpa finish).
  const early = await openSocket(port);
  clients.push(early);
  await httpExchange(early, 'POST /early HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{"a":');
  await sleep(100);
  assert.equal(serverSockets[2].listenerCount('timeout'), baseline, 'listener bersih saat response ditutup paksa');
});

async function waitHealth(base, tries = 300) {
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

function rawRequest(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload));
    let data = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('timeout')));
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8');
    });
    socket.on('close', () => resolve(data));
    socket.on('error', reject);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('error', reject);
    socket.once('connect', () => resolve(socket));
  });
}

/** Kirim header + sebagian body lalu diam; guard harus menutup koneksi. */
async function stallBody(port, head, waitMs = 700) {
  const socket = await openSocket(port);
  let data = '';
  let closedAt = 0;
  const start = Date.now();
  socket.on('data', (chunk) => {
    data += chunk.toString('utf8');
  });
  socket.once('close', () => {
    closedAt = Date.now() - start;
  });
  socket.write(head);
  await sleep(waitMs);
  socket.destroy();
  return { data, closedAt };
}

function multipartBody(boundary, filename, content) {
  return Buffer.from(
    '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      content + '\r\n' +
      '--' + boundary + '--\r\n',
  );
}

/** Kirim body bertahap dengan jeda di bawah idle; server tidak boleh memutus. */
async function trickleBody(port, head, body, chunkSize, delay) {
  const socket = await openSocket(port);
  let data = '';
  socket.on('data', (chunk) => {
    data += chunk.toString('utf8');
  });
  socket.write(head);
  for (let i = 0; i < body.length; i += chunkSize) {
    await sleep(delay);
    socket.write(body.subarray(i, i + chunkSize));
  }
  await new Promise((resolve) => {
    socket.setTimeout(5000, () => socket.destroy());
    socket.once('close', resolve);
  });
  return data;
}

test('security proxy: credential, policy sesi, CSP sandbox, ticket', async (t) => {
  const data = await mkdtemp(join(tmpdir(), 'st-sec-data-'));
  const files = await mkdtemp(join(tmpdir(), 'st-sec-files-'));
  const apiPort = 3500 + Math.floor(Math.random() * 200);
  const base = 'http://127.0.0.1:' + apiPort;

  /** Header yang benar-benar diterima upstream; inti regression test SEC-01. */
  const seen = [];
  const upgrades = [];
  const upstream = http.createServer((req, res) => {
    const entry = { url: req.url, headers: req.headers, body: '' };
    seen.push(entry);
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      entry.body = Buffer.concat(chunks).toString('utf8');
      const reply = () => {
        if (req.url.startsWith('/html')) {
          res.writeHead(200, {
            'content-type': 'text/html',
            'content-security-policy': "default-src * 'unsafe-inline'",
            'set-cookie': 'target=1; Path=/',
          });
          res.end('<html><head></head><body><script>fetch("/api/auth/me")</script></body></html>');
          return;
        }
        if (req.url.startsWith('/svg')) {
          res.writeHead(200, { 'content-type': 'image/svg+xml' });
          res.end('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      };
      // Respons sengaja lebih lambat dari idle body: timer body harus sudah dilepas.
      if (req.url.startsWith('/slow')) setTimeout(reply, 600);
      else reply();
    });
  });
  upstream.on('upgrade', (req, socket) => {
    upgrades.push(req.headers);
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.destroy();
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const targetOrigin = 'http://127.0.0.1:' + upstreamPort;
  const token = Buffer.from(targetOrigin, 'utf8').toString('base64url');
  const hex = Buffer.from(targetOrigin, 'utf8').toString('hex');

  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: ROOT + 'apps/api',
    env: {
      ...process.env,
      ST_PORT: String(apiPort),
      ST_DATA_DIR: data,
      ST_FS_ROOTS: files,
      ST_PROXY_ALLOW_PUBLIC: '0',
      ST_UPLOAD_IDLE_MS: '200',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let childErr = '';
  child.stderr?.on('data', (chunk) => {
    childErr += chunk.toString();
  });

  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await rm(data, { recursive: true, force: true });
    await rm(files, { recursive: true, force: true });
  });

  try {
    await waitHealth(base);
  } catch (err) {
    throw new Error(String(err) + ' :: ' + childErr.slice(-800));
  }

  const login = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'password' }),
  });
  assert.equal(login.status, 201);
  const mustChangeCookie = cookieOf(login);

  // SEC-02 (WS): handshake tanpa sesi dan dengan mustChange harus ditolak
  // sebelum upstream dihubungi.
  const anonWs =
    'GET /api/proxy/b/' + token + '/socket HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + apiPort + '\r\n' +
    'Connection: Upgrade\r\n' +
    'Upgrade: websocket\r\n' +
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
    'Sec-WebSocket-Version: 13\r\n\r\n';
  const anonReply = await rawRequest(apiPort, anonWs);
  assert.doesNotMatch(anonReply, /101 Switching Protocols/);
  assert.equal(upgrades.length, 0, 'WS anonim tidak boleh menyentuh upstream');

  const mustChangeWs = anonWs.replace('\r\n\r\n', '\r\nCookie: ' + mustChangeCookie + '\r\n\r\n');
  const mustChangeReply = await rawRequest(apiPort, mustChangeWs);
  assert.match(mustChangeReply, /403 Forbidden/);
  assert.equal(upgrades.length, 0, 'WS mustChange tidak boleh menyentuh upstream');

  // SEC-02: password-change policy juga berlaku di middleware proxy.
  const blocked = await fetch(base + '/api/proxy/b/' + token + '/echo', {
    headers: { cookie: mustChangeCookie },
  });
  assert.equal(blocked.status, 403, 'mustChange harus menolak proxy path');
  assert.equal(seen.length, 0, 'upstream tidak boleh disentuh saat policy menolak');

  const blockedTicket = await fetch(base + '/api/proxy/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: mustChangeCookie, 'x-st-csrf': '1' },
    body: JSON.stringify({ origin: targetOrigin }),
  });
  assert.equal(blockedTicket.status, 403, 'mustChange harus menolak penerbitan tiket');

  const changed = await fetch(base + '/api/auth/change-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: mustChangeCookie, 'x-st-csrf': '1' },
    body: JSON.stringify({ current: 'password', next: 'password123' }),
  });
  assert.equal(changed.status, 201);
  const cookie = cookieOf(changed);

  // SEC-01: credential Super Tool tidak boleh sampai ke upstream.
  const echo = await fetch(base + '/api/proxy/b/' + token + '/echo', {
    headers: {
      cookie: cookie + '; st_proxy=bocor; target=1',
      authorization: 'Bearer bocor',
      'proxy-authorization': 'Basic bocor',
      'x-st-csrf': '1',
      accept: 'application/json',
    },
  });
  assert.equal(echo.status, 200);
  const echoHeaders = seen.at(-1).headers;
  assert.equal(echoHeaders.cookie, 'target=1');
  assert.equal(echoHeaders.authorization, undefined);
  assert.equal(echoHeaders['proxy-authorization'], undefined);
  assert.equal(echoHeaders['x-st-csrf'], undefined);
  assert.equal(echoHeaders.accept, 'application/json');
  assert.equal(echoHeaders.origin, targetOrigin);

  // SEC-01/Phase 1+2: Connection-nominated dan metadata forwarded dari caller
  // tidak boleh sampai ke upstream.
  const forged =
    'GET /api/proxy/b/' + token + '/echo HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + apiPort + '\r\n' +
    'Cookie: ' + cookie + '\r\n' +
    'Connection: close, X-Internal-Metadata\r\n' +
    'X-Internal-Metadata: rahasia\r\n' +
    'Forwarded: for=1.2.3.4\r\n' +
    'X-Forwarded-For: 9.9.9.9\r\n' +
    'X-Forwarded-Host: evil.test\r\n' +
    'X-Forwarded-Proto: https\r\n' +
    'X-Forwarded-Port: 443\r\n' +
    'X-Real-IP: 8.8.8.8\r\n' +
    'Accept: application/json\r\n\r\n';
  const forgedReply = await rawRequest(apiPort, forged);
  assert.match(forgedReply, /200 OK/);
  const forgedHeaders = seen.at(-1).headers;
  for (const key of [
    'x-internal-metadata',
    'forwarded',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-real-ip',
  ]) {
    assert.equal(forgedHeaders[key], undefined, key + ' tidak boleh diteruskan');
  }
  assert.equal(forgedHeaders.accept, 'application/json');

  // Phase 3A: body multipart macet dihentikan; body yang mengalir di bawah
  // idle tetap diterima; respons lambat setelah body selesai tidak diputus.
  const boundary = 'st-boundary';
  const fileBody = multipartBody(boundary, 'a.txt', 'isi');
  const uploadHead =
    'POST /api/fs/upload?path=' + encodeURIComponent(files) + ' HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + apiPort + '\r\n' +
    'Cookie: ' + cookie + '\r\n' +
    'X-ST-CSRF: 1\r\n' +
    'Content-Type: multipart/form-data; boundary=' + boundary + '\r\n' +
    'Content-Length: ' + fileBody.length + '\r\n' +
    'Connection: close\r\n\r\n';

  const idleStart = Date.now();
  const stalledUpload = await stallBody(apiPort, uploadHead.replace('Content-Length: ' + fileBody.length, 'Content-Length: 1000'));
  const idleElapsed = Date.now() - idleStart;
  assert.ok(!/HTTP\/1\.1 2\d\d/.test(stalledUpload.data), 'upload macet tidak boleh sukses');
  assert.ok(stalledUpload.closedAt > 50 && stalledUpload.closedAt < 600, 'guard harus menutup upload macet, closedAt=' + stalledUpload.closedAt);
  assert.ok(idleElapsed < 3000, 'idle timeout upload harus aktif, elapsed=' + idleElapsed);

  // Data yang tetap mengalir (jeda < idle) tidak boleh diputus.
  const trickled = await trickleBody(apiPort, uploadHead, fileBody, 8, 60);
  assert.match(trickled, /HTTP\/1\.1 200|HTTP\/1\.1 201/, 'upload lambat tapi mengalir harus diterima, reply=' + trickled.slice(0, 120));

  // Body selesai sebelum upstream lambat membalas: timer sudah dilepas.
  const slow = await fetch(base + '/api/proxy/b/' + token + '/slow', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ok: 1 }),
  });
  assert.equal(slow.status, 200, 'respons lambat setelah body tidak boleh diputus');

  // Phase 3B: proxy POST dengan body tidak lengkap tidak boleh sampai ke upstream.
  const seenBeforePartial = seen.length;
  const partialProxy = await stallBody(
    apiPort,
    'POST /api/proxy/b/' + token + '/echo HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + apiPort + '\r\n' +
      'Cookie: ' + cookie + '\r\n' +
      'Content-Type: application/json\r\n' +
      'Content-Length: 100\r\n' +
      'Connection: close\r\n\r\n' +
      '{"partial":',
  );
  assert.ok(partialProxy.closedAt > 50 && partialProxy.closedAt < 600, 'body proxy macet harus ditutup, closedAt=' + partialProxy.closedAt);
  assert.equal(seen.length, seenBeforePartial, 'upstream tidak boleh menerima body proxy yang tidak lengkap');

  const proxyPost = await rawRequest(
    apiPort,
    'POST /api/proxy/b/' + token + '/echo HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + apiPort + '\r\n' +
      'Cookie: ' + cookie + '\r\n' +
      'Content-Type: application/json\r\n' +
      'Content-Length: 11\r\n' +
      'Connection: close\r\n\r\n' +
      '{"hello":1}',
  );
  assert.match(proxyPost, /200 OK/, 'proxy POST normal harus tetap jalan');
  assert.equal(seen.at(-1).body, '{"hello":1}', 'body proxy normal tetap utuh');

  // Phase 3C: webhook — body macet dihentikan, batas ukuran tetap berlaku,
  // body normal tetap utuh.
  const hookInfo = await (await fetch(base + '/api/webhook', { headers: { cookie } })).json();
  const hookToken = hookInfo.endpoints[0].token;
  const hookHead =
    'POST /api/hook/' + hookToken + ' HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + apiPort + '\r\n' +
    'Content-Type: application/json\r\n';

  const stalledHook = await stallBody(apiPort, hookHead + 'Content-Length: 100\r\nConnection: close\r\n\r\n{"a":');
  assert.ok(stalledHook.closedAt > 50 && stalledHook.closedAt < 600, 'body webhook macet harus ditutup, closedAt=' + stalledHook.closedAt);

  const hookOk = await fetch(base + '/api/hook/' + hookToken, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ping: 1 }),
  });
  assert.equal(hookOk.status, 200, 'webhook normal harus tetap diterima');
  const hookData = await (await fetch(base + '/api/webhook', { headers: { cookie } })).json();
  assert.equal(hookData.items[0].body, '{"ping":1}', 'body webhook normal tetap utuh');

  const big = Buffer.alloc(11 * 1024 * 1024, 0x61);
  let bigReply = '';
  try {
    bigReply = await rawRequest(apiPort, hookHead + 'Content-Type: application/octet-stream\r\nContent-Length: ' + big.length + '\r\nConnection: close\r\n\r\n' + big.toString('latin1'));
  } catch {
    // Koneksi diputus saat body ditolak juga dianggap berhasil.
  }
  assert.ok(!/HTTP\/1\.1 201/.test(bigReply), 'body webhook di atas batas tidak boleh diterima');

  // Phase 3D: JSON tidak lengkap tidak boleh menunggu selamanya.
  const stalledJson = await stallBody(
    apiPort,
    'POST /api/auth/login HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + apiPort + '\r\n' +
      'Content-Type: application/json\r\n' +
      'Content-Length: 100\r\n' +
      'Connection: close\r\n\r\n' +
      '{"password":',
  );
  assert.ok(stalledJson.closedAt > 50 && stalledJson.closedAt < 600, 'body JSON macet harus ditutup, closedAt=' + stalledJson.closedAt);
  assert.ok(!/HTTP\/1\.1 2\d\d/.test(stalledJson.data), 'login dengan body tidak lengkap tidak boleh sukses');

  // Phase 3E: keep-alive tidak mewarisi timer body lama; disconnect aman.
  const keepAlive = await openSocket(apiPort);
  let keepAliveData = '';
  keepAlive.on('data', (chunk) => {
    keepAliveData += chunk.toString('utf8');
  });
  keepAlive.write(
    'POST /api/hook/' + hookToken + ' HTTP/1.1\r\n' +
      'Host: 127.0.0.1:' + apiPort + '\r\n' +
      'Content-Type: application/json\r\n' +
      'Content-Length: 2\r\n' +
      'Connection: keep-alive\r\n\r\n{}',
  );
  await sleep(200);
  assert.match(keepAliveData, /HTTP\/1\.1 200/, 'request keep-alive pertama harus selesai');
  await sleep(400);
  keepAliveData = '';
  keepAlive.write('GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:' + apiPort + '\r\nConnection: close\r\n\r\n');
  await sleep(200);
  assert.match(keepAliveData, /200 OK/, 'socket keep-alive tidak boleh mewarisi timer body lama');
  keepAlive.destroy();

  const dropped = await openSocket(apiPort);
  dropped.write(hookHead + 'Content-Length: 100\r\n\r\n{"x":');
  await sleep(50);
  dropped.destroy();
  await sleep(100);
  const stillAlive = await fetch(base + '/api/health');
  assert.equal(stillAlive.status, 200, 'server tetap sehat setelah client memutus body');

  // SEC-06: HTML path mode tetap origin opak dan CSP upstream tidak menang.
  const html = await fetch(base + '/api/proxy/b/' + token + '/html', { headers: { cookie } });
  const csp = html.headers.get('content-security-policy') ?? '';
  assert.match(csp, /sandbox/);
  assert.doesNotMatch(csp, /allow-same-origin/);
  assert.doesNotMatch(csp, /default-src/);
  assert.match(await html.text(), /<script>/);

  const svg = await fetch(base + '/api/proxy/b/' + token + '/svg', { headers: { cookie } });
  assert.match(svg.headers.get('content-security-policy') ?? '', /sandbox/);

  // SEC-06: legacy `/api/proxy?u=` juga disandbox.
  const legacy = await fetch(base + '/api/proxy?u=' + encodeURIComponent(targetOrigin + '/html'), {
    headers: { cookie },
  });
  assert.equal(legacy.status, 200);
  const legacyCsp = legacy.headers.get('content-security-policy') ?? '';
  assert.match(legacyCsp, /sandbox/);
  assert.doesNotMatch(legacyCsp, /allow-same-origin/);
  assert.equal(legacy.headers.get('x-content-type-options'), 'nosniff');
  const legacySvg = await fetch(base + '/api/proxy?u=' + encodeURIComponent(targetOrigin + '/svg'), {
    headers: { cookie },
  });
  assert.match(legacySvg.headers.get('content-security-policy') ?? '', /sandbox/, 'SVG legacy tidak boleh same-origin');

  const metadata = await fetch(base + '/api/proxy?u=' + encodeURIComponent('http://169.254.169.254/'), {
    headers: { cookie },
  });
  assert.equal(metadata.status, 400);

  // SEC-01 (WS): handshake tidak membawa cookie credential.
  const upgradePayload =
    'GET /api/proxy/b/' + token + '/socket HTTP/1.1\r\n' +
    'Host: 127.0.0.1:' + apiPort + '\r\n' +
    'Connection: Upgrade, X-Internal-Metadata\r\n' +
    'X-Internal-Metadata: rahasia\r\n' +
    'Upgrade: websocket\r\n' +
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
    'Sec-WebSocket-Version: 13\r\n' +
    'Cookie: ' + cookie + '; st_proxy=bocor; target=1\r\n' +
    'Authorization: Bearer bocor\r\n' +
    '\r\n';
  const upgradeReply = await rawRequest(apiPort, upgradePayload);
  assert.match(upgradeReply, /101 Switching Protocols/, 'handshake proxy harus diteruskan');
  const wsHeaders = upgrades.at(-1);
  assert.equal(wsHeaders.cookie, 'target=1');
  assert.equal(wsHeaders.authorization, undefined);
  assert.equal(wsHeaders['x-internal-metadata'], undefined, 'token Connection tidak boleh diteruskan');
  assert.equal(wsHeaders['sec-websocket-key'], 'dGhlIHNhbXBsZSBub25jZQ==');
  assert.equal(wsHeaders['sec-websocket-version'], '13');
  assert.match(String(wsHeaders.connection), /upgrade/i);
  assert.equal(wsHeaders.origin, targetOrigin);
  assert.doesNotMatch(upgradeReply + JSON.stringify(wsHeaders), /st_session|st_proxy=bocor/);

  // Tiket subdomain: terbit setelah policy lolos, dipakai, dan tidak bocor ke upstream.
  const ticketRes = await fetch(base + '/api/proxy/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-st-csrf': '1' },
    body: JSON.stringify({ origin: targetOrigin }),
  });
  assert.equal(ticketRes.status, 201);
  const { ticket } = await ticketRes.json();

  const badTicket = await rawRequest(
    apiPort,
    'GET /echo HTTP/1.1\r\nHost: ' + hex + '.localhost:' + apiPort + '\r\nCookie: st_proxy=salah\r\nConnection: close\r\n\r\n',
  );
  assert.match(badTicket, /401 Unauthorized/);

  // Phase 3 (WS): tiket subdomain invalid ditolak, tiket valid tetap jalan
  // tanpa membawa cookie/tiket ke upstream.
  const wsTicketBase =
    'GET /socket HTTP/1.1\r\n' +
    'Host: ' + hex + '.localhost:' + apiPort + '\r\n' +
    'Connection: Upgrade\r\n' +
    'Upgrade: websocket\r\n' +
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
    'Sec-WebSocket-Version: 13\r\n';
  const badTicketWs = await rawRequest(apiPort, wsTicketBase + 'Cookie: st_proxy=salah\r\n\r\n');
  assert.match(badTicketWs, /401 Unauthorized/);
  assert.equal(upgrades.length, 1, 'tiket invalid tidak boleh membuka koneksi upstream');

  const validTicketWs = await rawRequest(apiPort, wsTicketBase + 'Cookie: st_proxy=' + ticket + '\r\n\r\n');
  assert.match(validTicketWs, /101 Switching Protocols/);
  const wsTicketHeaders = upgrades.at(-1);
  assert.equal(wsTicketHeaders.cookie, undefined, 'tiket proxy tidak boleh diteruskan ke upstream');
  assert.equal(wsTicketHeaders['sec-websocket-key'], 'dGhlIHNhbXBsZSBub25jZQ==');
  assert.equal(wsTicketHeaders.origin, targetOrigin);

  const viaTicket = await rawRequest(
    apiPort,
    'GET /echo HTTP/1.1\r\nHost: ' + hex + '.localhost:' + apiPort + '\r\nCookie: st_proxy=' + ticket + '\r\nConnection: close\r\n\r\n',
  );
  assert.match(viaTicket, /200 OK/);
  const ticketHeaders = seen.at(-1).headers;
  assert.equal(ticketHeaders.cookie, undefined, 'tiket proxy tidak boleh diteruskan ke upstream');
});
