import assert from 'node:assert/strict';
import test from 'node:test';
import { inRoots } from './dist/common/fs-jail.js';
import { signToken, verifyToken } from './dist/common/token.js';
import { isAllowedHost } from './dist/modules/downloader/downloader.service.js';
import { authPrompt } from './dist/modules/calendar/oauth.js';
import { WebhookService } from './dist/modules/webhook/webhook.service.js';

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

test('downloader: allowlist host tidak bisa ditipu suffix', () => {
  assert.equal(isAllowedHost('www.youtube.com'), true);
  assert.equal(isAllowedHost('youtu.be'), true);
  assert.equal(isAllowedHost('fb.watch'), true);
  assert.equal(isAllowedHost('b23.tv'), true);
  assert.equal(isAllowedHost('youtube.com.evil.test'), false);
  assert.equal(isAllowedHost('evil-youtube.com'), false);
  assert.equal(isAllowedHost('127.0.0.1'), false);
});
