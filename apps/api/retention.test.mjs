import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Modul db membuat database saat diimpor, jadi arahkan ke folder sementara dulu.
const dir = await mkdtemp(join(tmpdir(), 'st-retention-'));
process.env.ST_DATA_DIR = dir;

const require = createRequire(import.meta.url);
const { run, one } = require('./dist/common/db.js');
const { AuditService } = require('./dist/modules/audit/audit.service.js');
const { CompareService } = require('./dist/modules/compare/compare.service.js');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const old = now - 31 * DAY;
const recent = now - DAY;

after(() => rm(dir, { recursive: true, force: true }));

test('retention: audit lebih dari 30 hari dihapus, yang baru tetap', () => {
  run(
    "INSERT INTO audit_log (ts, source, actor, feature, action, method) VALUES (?, 'web', 'lama', 'uji', 'prune', 'GET')",
    old,
  );
  run(
    "INSERT INTO audit_log (ts, source, actor, feature, action, method) VALUES (?, 'web', 'baru', 'uji', 'prune', 'GET')",
    recent,
  );

  const removed = new AuditService().prune(now);

  assert.equal(removed, 1);
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'lama'").n, 0);
  assert.equal(one("SELECT COUNT(*) AS n FROM audit_log WHERE actor = 'baru'").n, 1);
});

test('retention: compare_history lebih dari 30 hari dihapus, yang baru tetap', () => {
  run(
    "INSERT INTO compare_history (created_at, left_text, right_text, left_lines, right_lines) VALUES (?, 'lama', 'lama', 1, 1)",
    old,
  );
  run(
    "INSERT INTO compare_history (created_at, left_text, right_text, left_lines, right_lines) VALUES (?, 'baru', 'baru', 1, 1)",
    recent,
  );

  const removed = new CompareService().prune(now);

  assert.equal(removed, 1);
  assert.equal(one("SELECT COUNT(*) AS n FROM compare_history WHERE left_text = 'lama'").n, 0);
  assert.equal(one("SELECT COUNT(*) AS n FROM compare_history WHERE left_text = 'baru'").n, 1);
});
