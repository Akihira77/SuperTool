import assert from 'node:assert/strict';
import test from 'node:test';
import proxyMiddleware from './dist/modules/proxy/proxy.middleware.js';

const { PROXY_PREFIX, originFromToken, hexToken, originFromHex, subdomainTarget, proxyUrl } = proxyMiddleware;
const ORIGIN = 'http://127.0.0.1:8080';

test('proxy: token base64url bolak-balik ke origin', () => {
  const token = proxyMiddleware.proxyBase(ORIGIN).slice(PROXY_PREFIX.length).replace(/\/$/, '');
  assert.equal(originFromToken(token), ORIGIN);
  assert.match(token, /^[A-Za-z0-9_-]+$/, 'token harus aman untuk path URL');
});

test('proxy: token sampah ditolak, bukan crash', () => {
  for (const bad of ['', 'bukan-token', '!!!', Buffer.from('ftp://x').toString('base64url')]) {
    assert.equal(originFromToken(bad), null, bad);
  }
  assert.equal(originFromToken(Buffer.from('http://127.0.0.1:8080', 'utf8').toString('base64url')), ORIGIN);
});

test('proxy: token hex valid, hex sampah ditolak', () => {
  const token = hexToken(ORIGIN);
  assert.equal(originFromHex(token), ORIGIN);
  assert.equal(originFromHex(token.toUpperCase()), ORIGIN, 'nama host bisa lowercase, hex tetap sah');
  for (const bad of ['', 'zz', 'abc', 'a'.repeat(64), 'abcde', Buffer.from('file:///x').toString('hex')]) {
    assert.equal(originFromHex(bad), null, bad);
  }
});

test('proxy: subdomainTarget hanya menerima <hex>.localhost', () => {
  const token = hexToken(ORIGIN);
  assert.deepEqual(subdomainTarget(token + '.localhost:3001'), { token, origin: ORIGIN });
  assert.deepEqual(subdomainTarget(token + '.LOCALHOST'), { token, origin: ORIGIN });
  assert.equal(subdomainTarget('contoh.localhost:3001'), null);
  assert.equal(subdomainTarget('evil.example.com:3001'), null);
  assert.equal(subdomainTarget(token + '.example.com'), null);
  assert.equal(subdomainTarget(undefined), null);
});

test('proxy: proxyUrl menulis path target lewat prefix proxy', () => {
  const token = Buffer.from(ORIGIN, 'utf8').toString('base64url');
  assert.equal(proxyUrl(ORIGIN, '/api/items?q=1'), PROXY_PREFIX + token + '/api/items?q=1');
  assert.equal(proxyUrl(ORIGIN, ORIGIN + '/a/b'), PROXY_PREFIX + token + '/a/b');
  assert.equal(proxyUrl(ORIGIN, 'relatif?x=2'), PROXY_PREFIX + token + '/relatif?x=2');
  assert.equal(proxyUrl(ORIGIN, 'http://contoh.test/luar'), 'http://contoh.test/luar', 'origin asing tidak boleh diproksikan');
});
