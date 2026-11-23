import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, copyFile } from 'node:fs/promises';
import { existsSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const archiver = require('archiver');
const ZipArchive = archiver.ZipArchive ?? archiver;

function zip(entries) {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks = [];
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    for (const [name, content] of Object.entries(entries)) archive.append(content, { name });
    void archive.finalize();
  });
}

const dir = await mkdtemp(join(tmpdir(), 'st-restore-test-'));
process.env.ST_DATA_DIR = dir;
const dbModule = require('./dist/common/db.js');
const { BackupService } = require('./dist/modules/backup/backup.service.js');

const live = () => dbModule.db;
live().exec("INSERT INTO account (id,salt,hash,pv,must_change,secret,created_at) VALUES (1,'s','h',1,0,'x',1)");
live().exec("INSERT INTO notes (id,title,body,created_at,updated_at) VALUES ('n1','lama','b',1,1)");
await mkdir(join(dir, 'uploads'), { recursive: true });
await writeFile(join(dir, 'uploads', 'lama.txt'), 'lama');
live().exec("VACUUM INTO '" + dir + "/snapshot.db'");
const snapshot = await readFile(join(dir, 'snapshot.db'));
const service = new BackupService();
const restore = (name, buffer) => service.restore({ originalname: name, buffer, size: buffer.length });

test.after(async () => {
  try { live().close(); } catch {}
  await rm(dir, { recursive: true, force: true });
});

test('restore: database dan uploads diganti, sesi dicabut', async () => {
  live().exec("INSERT INTO notes (id,title,body,created_at,updated_at) VALUES ('n2','baru','b',2,2)");
  await writeFile(join(dir, 'uploads', 'baru.txt'), 'baru');
  const archive = await zip({
    'super-tool.db': snapshot,
    'uploads/lama.txt': 'lama',
    'backup.json': '{}',
  });
  const result = await restore('baik.zip', archive);
  assert.equal(result.ok, true);
  assert.equal(result.uploads, true);
  assert.deepEqual(live().prepare('SELECT id FROM notes ORDER BY id').all().map((row) => row.id), ['n1']);
  assert.deepEqual(await readdir(join(dir, 'uploads')), ['lama.txt']);
  assert.equal(Number(live().prepare('SELECT pv FROM account').get().pv), 2);
});

test('restore: traversal ditolak sebelum ekstraksi', async () => {
  // Zip mentah: archiver menormalkan '../', jadi entri ini dibuat langsung.
  const archive = Buffer.from(
    'UEsDBBQAAAAAAMeMal2DFtyMAQAAAAEAAAALAAAALi4vZXZpbC50eHR4UEsBAhQDFAAAAAAAx4xqXYMW3IwBAAAAAQAAAAsAAAAAAAAAAAAAAIABAAAAAC4uL2V2aWwudHh0UEsFBgAAAAABAAEAOQAAACoAAAAAAA==',
    'base64',
  );
  await assert.rejects(() => restore('traversal.zip', archive), /path tidak aman/);
  assert.deepEqual(live().prepare('SELECT id FROM notes ORDER BY id').all().map((row) => row.id), ['n1']);
});

test('restore: entri di luar struktur backup ditolak', async () => {
  const archive = await zip({ 'super-tool.db': snapshot, 'lain.txt': 'x' });
  await assert.rejects(() => restore('lain.zip', archive), /di luar struktur backup/);
});

test('restore: database rusak ditolak tanpa mengubah data', async () => {
  const archive = await zip({ 'super-tool.db': Buffer.from('bukan sqlite sama sekali'.repeat(100)) });
  await assert.rejects(() => restore('rusak.zip', archive), /bukan SQLite yang valid/);
  assert.equal(Number(live().prepare('SELECT COUNT(*) AS n FROM notes').get().n), 1);
});

test('restore: versi skema lebih baru ditolak', async () => {
  const copy = join(dir, 'versi2.db');
  await copyFile(join(dir, 'snapshot.db'), copy);
  const newer = new DatabaseSync(copy);
  newer.exec('PRAGMA user_version = 2');
  newer.close();
  const archive = await zip({ 'super-tool.db': await readFile(copy) });
  await assert.rejects(() => restore('versi2.zip', archive), /Versi skema backup tidak didukung/);
});

test('restore: arsip tanpa uploads mempertahankan uploads lama', async () => {
  await writeFile(join(dir, 'uploads', 'tetap.txt'), 'tetap');
  const archive = await zip({ 'super-tool.db': snapshot, 'backup.json': '{}' });
  const result = await restore('tanpa-uploads.zip', archive);
  assert.equal(result.uploads, false);
  assert.deepEqual((await readdir(join(dir, 'uploads'))).sort(), ['lama.txt', 'tetap.txt']);
});

test('restore: upload dari disk (tanpa buffer) diproses lalu dihapus', async () => {
  const archive = await zip({ 'super-tool.db': snapshot, 'backup.json': '{}' });
  const file = join(dir, 'upload-disk.zip');
  await writeFile(file, archive);
  const result = await service.restore({ originalname: 'disk.zip', path: file, size: archive.length });
  assert.equal(result.ok, true);
  await assert.rejects(() => readFile(file), /ENOENT/);
});

const dbPath = join(dir, 'super-tool.db');
const oldPath = dbPath + '.restore-old';
const incomingPath = dbPath + '.restore-new';
const journalPath = dbPath + '.restore-journal';
const snapshotPath = join(dir, 'snapshot.db');
const noteIds = () => live().prepare('SELECT id FROM notes ORDER BY id').all().map((row) => row.id);
const artifacts = () => [oldPath, incomingPath, journalPath].filter((path) => existsSync(path));

test('restore: salinan gagal saat WAL belum checkpoint tidak menghapus data', () => {
  live().exec('PRAGMA wal_autocheckpoint = 0');
  live().exec("INSERT INTO notes (id,title,body,created_at,updated_at) VALUES ('wal-keep','penting','b',3,3)");
  const wal = dbPath + '-wal';
  assert.ok(existsSync(wal) && statSync(wal).size > 0, 'WAL harus memuat data yang belum checkpoint');
  const before = noteIds();

  assert.throws(
    () => dbModule.replaceDatabase(snapshotPath, { copyFile: () => { throw new Error('injected copy'); } }),
    /Gagal menyalin database restore/,
  );

  assert.deepEqual(noteIds(), before, 'data lama dan WAL harus utuh');
  assert.equal(String(live().prepare('PRAGMA integrity_check').get().integrity_check), 'ok');
  assert.deepEqual(artifacts(), [], 'tidak boleh menyisakan artefak restore');
  live().exec('PRAGMA wal_autocheckpoint = 1000');
});

test('restore: fsync incoming gagal mengembalikan database lama', () => {
  const before = noteIds();
  assert.throws(
    () => dbModule.replaceDatabase(snapshotPath, { fsyncFile: () => { throw new Error('injected fsync'); } }),
    /Gagal fsync database restore/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
});

test('restore: rename database lama gagal mengembalikan database lama', () => {
  const before = noteIds();
  let failed = false;
  assert.throws(
    () =>
      dbModule.replaceDatabase(snapshotPath, {
        rename: (from, to) => {
          if (!failed && from === dbPath) {
            failed = true;
            throw new Error('injected rename');
          }
          renameSync(from, to);
        },
      }),
    /Gagal memindahkan database lama/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
  assert.ok(!existsSync(oldPath) || existsSync(dbPath));
});

test('restore: rename instalasi gagal mengembalikan database lama', () => {
  const before = noteIds();
  let failed = false;
  assert.throws(
    () =>
      dbModule.replaceDatabase(snapshotPath, {
        rename: (from, to) => {
          if (!failed && to === dbPath) {
            failed = true;
            throw new Error('injected install');
          }
          renameSync(from, to);
        },
      }),
    /Gagal memasang database baru/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
});

test('restore: buka database baru gagal mengembalikan database lama', () => {
  const before = noteIds();
  assert.throws(
    () => dbModule.replaceDatabase(snapshotPath, { open: () => { throw new Error('injected open'); } }),
    /Gagal membuka database baru/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
});

test('restore: konfigurasi database baru gagal mengembalikan database lama', () => {
  const before = noteIds();
  assert.throws(
    () => dbModule.replaceDatabase(snapshotPath, { configure: () => { throw new Error('injected configure'); } }),
    /Gagal mengonfigurasi database baru/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
});

test('restore: skema database baru gagal mengembalikan database lama', () => {
  const before = noteIds();
  assert.throws(
    () => dbModule.replaceDatabase(snapshotPath, { migrate: () => { throw new Error('injected schema'); } }),
    /Gagal menyiapkan skema database baru/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
});

test('restore: checkpoint gagal tidak menutup atau mengubah database aktif', () => {
  const before = noteIds();
  assert.throws(
    () => dbModule.replaceDatabase(snapshotPath, { checkpoint: () => { throw new Error('injected checkpoint'); } }),
    /Checkpoint database gagal/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
  assert.equal(Number(live().prepare('SELECT COUNT(*) AS n FROM notes').get().n), before.length);
});

test('restore: incoming tidak valid tidak menyentuh database aktif', () => {
  const before = noteIds();
  assert.throws(
    () => dbModule.replaceDatabase(snapshotPath, { validate: () => { throw new Error('injected validate'); } }),
    /Database restore tidak valid: injected validate/,
  );
  assert.deepEqual(noteIds(), before);
  assert.deepEqual(artifacts(), []);
});

test('restore: pembersihan artefak gagal tetap dianggap sukses setelah commit', () => {
  let oldRemovals = 0;
  const result = dbModule.replaceDatabase(snapshotPath, {
    remove: (path) => {
      if (path === oldPath) {
        oldRemovals += 1;
        if (oldRemovals === 2) throw new Error('injected cleanup');
      }
      rmSync(path, { force: true });
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(noteIds(), ['n1'], 'database baru sudah aktif');
  assert.equal(existsSync(journalPath), false, 'journal commit harus hilang');
  assert.equal(existsSync(oldPath), true, 'artefak lama boleh tersisa saat cleanup gagal');
  rmSync(oldPath, { force: true });
  assert.deepEqual(artifacts(), []);
});

test('restore: dua restore bersamaan ditolak, satu tetap berhasil', async () => {
  const first = await zip({ 'super-tool.db': snapshot, 'backup.json': '{}' });
  const second = await zip({ 'super-tool.db': snapshot, 'backup.json': '{}' });
  const results = await Promise.allSettled([restore('satu.zip', first), restore('dua.zip', second)]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = results.find((item) => item.status === 'rejected');
  assert.match(String(rejected?.reason?.message ?? ''), /Restore lain sedang berjalan/);
  assert.deepEqual(noteIds(), ['n1']);
});

const dbModulePath = require.resolve('./dist/common/db.js');

function runNode(script, env) {
  return spawnSync(process.execPath, [script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('restore: crash di setiap tahap dipulihkan ke database yang konsisten', async () => {
  const crashScript = join(dir, 'crash-child.cjs');
  const readScript = join(dir, 'read-child.cjs');
  await writeFile(
    crashScript,
    [
      "const m = require(process.env.DB_MODULE);",
      "m.db.exec(\"INSERT INTO notes (id,title,body,created_at,updated_at) VALUES ('keep','lama','b',1,1)\");",
      'm.replaceDatabase(process.env.SOURCE_DB, {',
      "  onPhase: (phase) => { if (phase === process.env.CRASH_AT) process.exit(97); },",
      '});',
    ].join('\n'),
  );
  await writeFile(
    readScript,
    [
      'const m = require(process.env.DB_MODULE);',
      'const { readdirSync } = require("node:fs");',
      'const notes = m.db.prepare("SELECT id FROM notes ORDER BY id").all().map((row) => row.id);',
      'console.log(JSON.stringify({ notes, files: readdirSync(process.env.ST_DATA_DIR).sort() }));',
    ].join('\n'),
  );

  const scenarios = [
    { stage: 'replacing', expected: ['keep'] },
    { stage: 'old-moved', expected: ['keep'] },
    { stage: 'installed', expected: ['keep'] },
    { stage: 'committed', expected: ['n1'] },
  ];

  for (const scenario of scenarios) {
    const crashDir = await mkdtemp(join(tmpdir(), 'st-crash-' + scenario.stage + '-'));
    const source = join(crashDir, 'source.db');
    await copyFile(snapshotPath, source);

    const crashed = runNode(crashScript, {
      ST_DATA_DIR: crashDir,
      DB_MODULE: dbModulePath,
      SOURCE_DB: source,
      CRASH_AT: scenario.stage,
    });
    assert.equal(crashed.status, 97, 'child harus berhenti di tahap ' + scenario.stage + ': ' + crashed.stderr);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const recovered = runNode(readScript, { ST_DATA_DIR: crashDir, DB_MODULE: dbModulePath });
      assert.equal(recovered.status, 0, recovered.stderr);
      const state = JSON.parse(recovered.stdout.trim().split('\n').filter(Boolean).at(-1));
      assert.deepEqual(state.notes, scenario.expected, 'tahap ' + scenario.stage + ' percobaan ' + attempt);
      assert.deepEqual(state.files.filter((name) => name.includes('.restore-')), [], 'artefak harus bersih');
    }
    await rm(crashDir, { recursive: true, force: true });
  }
});
