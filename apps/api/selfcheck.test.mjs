import assert from 'node:assert/strict';
import test from 'node:test';
// SWC menulis ekspor CJS lewat getter, sehingga Node ESM tidak bisa
// mendeteksi named export. Ambil default lalu destructure.
import fsJail from './dist/common/fs-jail.js';
import token from './dist/common/token.js';
import downloader from './dist/modules/downloader/downloader.service.js';
import calendarOauth from './dist/modules/calendar/oauth.js';
import webhook from './dist/modules/webhook/webhook.service.js';
import devService from './dist/modules/dev/dev.service.js';
import storageUsage from './dist/modules/storage/storage-usage.service.js';
import auditPayload from './dist/modules/audit/audit.payload.js';
import netGuard from './dist/common/net-guard.js';
import textChunk from './dist/common/text-chunk.js';

const { inRoots } = fsJail;
const { signToken, verifyToken } = token;
const { isAllowedHost, canonicalBilibiliUrl } = downloader;
const { authPrompt } = calendarOauth;
const { WebhookService } = webhook;
const { dockerActionArgs, safeBranchName } = devService;
const { parseDuOutput, isCleanableFolder } = storageUsage;
const { serializeAuditPayload } = auditPayload;
const { isPrivateAddress, isMetadataAddress } = netGuard;
const { utf8Cut } = textChunk;

test('token: tanda tangan valid diterima, yang diubah ditolak', () => {
  const secret = 'rahasia-uji';
  const token = signToken({ exp: Date.now() + 60_000, pv: 3 }, secret);
  assert.equal(verifyToken(token, secret)?.pv, 3);
  assert.equal(verifyToken(token, 'secret-lain'), null);
  assert.equal(verifyToken(token.slice(0, -2) + 'xx', secret), null);
  assert.equal(verifyToken(signToken({ exp: Date.now() - 1, pv: 3 }, secret), secret), null);
});

test('jail: path di dalam root boleh, di luar ditolak', () => {
  const roots = ['/home/akihira17/personal'];
  assert.equal(inRoots('/home/akihira17/personal/super-tool', roots), true);
  assert.equal(inRoots('/home/akihira17/personal', roots), true);
  assert.equal(inRoots('/home/akihira17/personal-evil', roots), false);
  assert.equal(inRoots('/etc/passwd', roots), false);
  assert.equal(inRoots('/home/akihira17/personal', ['/']), true);
  assert.equal(inRoots('/etc/passwd', ['/']), true);
});

test('calendar: mode switch meminta pemilih akun', () => {
  assert.equal(authPrompt('connect'), 'consent');
  assert.match(authPrompt('switch'), /select_account/);
});

test('webhook: token endpoint bisa diganti dan divalidasi', () => {
  const hooks = new WebhookService();
  const first = hooks.create('uji');
  assert.equal(hooks.updateToken(first.id, 'custom-hook_1').token, 'custom-hook_1');
  assert.throws(() => hooks.updateToken(first.id, 'bad/token'), /Token hanya/);
  assert.throws(() => hooks.updateToken(first.id, ''), /Token hanya/);
  const second = hooks.create('lain');
  assert.throws(() => hooks.updateToken(second.id, 'custom-hook_1'), /sudah dipakai/);
});

test('docker: aksi lifecycle dibatasi dan argumen aman', () => {
  assert.deepEqual(dockerActionArgs('start', 'abc123'), ['start', 'abc123']);
  assert.deepEqual(dockerActionArgs('stop', 'abc123'), ['stop', 'abc123']);
  assert.deepEqual(dockerActionArgs('restart', 'abc123'), ['restart', 'abc123']);
  assert.deepEqual(dockerActionArgs('remove', 'abc123'), ['rm', '-f', 'abc123']);
  assert.throws(() => dockerActionArgs('exec', 'abc123'), /tidak didukung/);
  assert.throws(() => dockerActionArgs('start', 'abc; rm -rf /'), /ID container/);
  assert.throws(() => dockerActionArgs('start', '--help'), /ID container/);
});

test('storage: parse du NUL dan allowlist hapus aman', () => {
  const root = '/home/uji';
  const raw = '4096\t/home/uji/a\0' + '2048\t/home/uji/a/node_modules\0' + '10\t/home/uji-evil/x\0';
  assert.deepEqual(parseDuOutput(raw, root), [
    { path: '/home/uji/a', size: 4096 },
    { path: '/home/uji/a/node_modules', size: 2048 },
  ]);
  assert.equal(isCleanableFolder('node_modules'), true);
  assert.equal(isCleanableFolder('temp'), true);
  assert.equal(isCleanableFolder('.cache'), true);
  assert.equal(isCleanableFolder('personal'), false);
  assert.equal(isCleanableFolder('..'), false);
});

test('downloader: allowlist host tidak bisa ditipu suffix', () => {
  assert.equal(isAllowedHost('www.youtube.com'), true);
  assert.equal(isAllowedHost('youtu.be'), true);
  assert.equal(isAllowedHost('fb.watch'), true);
  assert.equal(isAllowedHost('b23.tv'), true);
  assert.equal(isAllowedHost('youtube.com.evil.test'), false);
  assert.equal(isAllowedHost('evil-youtube.com'), false);
  assert.equal(isAllowedHost('127.0.0.1'), false);
});

test('net guard: alamat privat, metadata, dan IPv4-mapped IPv6 diblokir', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '100.64.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '192.169.1.1', '203.0.114.1']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['2001:4860:4860::8888', '::ffff:8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
  for (const ip of ['169.254.169.254', '100.100.100.200', 'fd00:ec2::254', '::ffff:169.254.169.254']) {
    assert.equal(isMetadataAddress(ip), true, ip);
  }
  assert.equal(isMetadataAddress('169.254.1.1'), false);
});

test('audit: payload meredaksi rahasia dan membatasi ukuran', () => {
  const out = serializeAuditPayload({
    password: 'rahasia',
    cookies: 'sesi',
    body: { token: 'abc', ok: 'yes' },
    big: 'x'.repeat(9000),
  });
  assert.match(out, /"password":"\[REDACTED\]"/);
  assert.match(out, /"cookies":"\[REDACTED\]"/);
  assert.match(out, /"token":"\[REDACTED\]"/);
  assert.match(out, /truncated/);
  assert.ok(out.length < 10_000);
});

test('downloader: URL /en/video Bilibili dinormalisasi ke /video', () => {
  assert.equal(
    canonicalBilibiliUrl(new URL('https://www.bilibili.com/en/video/BV1Xa4y1h7LT?p=2&share_source=COPY')),
    'https://www.bilibili.com/video/BV1Xa4y1h7LT?p=2',
  );
  assert.equal(canonicalBilibiliUrl(new URL('https://b23.tv/KHQdMVt')), null);
  assert.equal(canonicalBilibiliUrl(new URL('https://www.bilibili.com/bangumi/play/ss123')), null);
});

test('git: nama branch ilegal ditolak sebelum menyentuh git', () => {
  assert.equal(safeBranchName('fitur/aman-1'), 'fitur/aman-1');
  for (const bad of ['', '-x', 'a b', 'a..b', 'a//b', 'a/', 'x.lock', 'x;rm', 'x$(id)']) {
    assert.throws(() => safeBranchName(bad), /Nama branch/);
  }
});

test('text chunk: potong di batas UTF-8, bukan di tengah karakter', () => {
  const buffer = Buffer.from('a\u20acb');
  assert.equal(utf8Cut(buffer, 0), 0);
  assert.equal(utf8Cut(buffer, 1), 1);
  assert.equal(utf8Cut(buffer, 2), 1);
  assert.equal(utf8Cut(buffer, 3), 1);
  assert.equal(utf8Cut(buffer, 4), 4);
  assert.equal(utf8Cut(buffer, buffer.length), buffer.length);
});
