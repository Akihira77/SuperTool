import assert from 'node:assert/strict';
import test from 'node:test';
import { inRoots } from './dist/common/fs-jail.js';
import { signToken, verifyToken } from './dist/common/token.js';

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
});
