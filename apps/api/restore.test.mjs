import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { chmod, mkdtemp, mkdir, writeFile, rm, readFile, readdir, copyFile } from 'node:fs/promises';
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

const pvOf = () => Number(live().prepare('SELECT pv FROM account').get().pv);
const uploadNames = async () => (await readdir(join(dir, 'uploads'))).sort();

test('restore: kegagalan saat memasang database mengembalikan database dan uploads', async () => {
  const beforeNotes = noteIds();
  const beforePv = pvOf();
  const beforeUploads = await uploadNames();
  const archive = await zip({
    'super-tool.db': snapshot,
    'uploads/baru.txt': 'baru',
    'backup.json': '{}',
  });

  await assert.rejects(
    () =>
      service.restore(
        { originalname: 'gagal.zip', buffer: archive, size: archive.length },
        {
          configure: () => {
            throw new Error('injected configure');
          },
        },
      ),
    /Gagal mengonfigurasi database baru/,
  );

  assert.deepEqual(noteIds(), beforeNotes, 'database lama tetap aktif');
  assert.equal(pvOf(), beforePv, 'pv database lama tidak berubah');
  assert.deepEqual(await uploadNames(), beforeUploads, 'uploads kembali ke generasi lama');
  assert.deepEqual(artifacts(), []);
  assert.equal(existsSync(join(dir, 'uploads.restore-old')), false);
});

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

test('restore: pembersihan artefak gagal setelah commit tidak membalik restore', () => {
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
  assert.equal(existsSync(oldPath), true, 'artefak lama boleh tersisa saat cleanup gagal');
  assert.equal(existsSync(journalPath), true, 'journal committed dipertahankan agar startup mengulang cleanup');

  // Startup berikutnya menyelesaikan pembersihan tanpa mengubah generasi aktif.
  dbModule.recoverInterruptedRestore();
  assert.equal(existsSync(journalPath), false, 'journal hilang setelah cleanup berhasil');
  assert.deepEqual(artifacts(), []);
  assert.deepEqual(noteIds(), ['n1'], 'recovery pasca-commit tidak mengubah data');
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

const backupModulePath = require.resolve('./dist/modules/backup/backup.service.js');

/** Database sumber restore yang valid tapi berbeda generasi dari data aktif. */
function makeSourceDb(path, pv) {
  const source = new DatabaseSync(path);
  try {
    source.exec(
      'CREATE TABLE account (id INTEGER PRIMARY KEY CHECK (id = 1), salt TEXT NOT NULL, hash TEXT NOT NULL, ' +
        'pv INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 1, secret TEXT NOT NULL, ' +
        'created_at INTEGER NOT NULL);' +
        "CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', " +
        'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);' +
        'CREATE TABLE urls (id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, ' +
        'proxy INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);' +
        'PRAGMA user_version = 1;',
    );
    source
      .prepare('INSERT INTO account (id,salt,hash,pv,must_change,secret,created_at) VALUES (1,?,?,?,0,?,1)')
      .run('s', 'h', pv, 'x');
    source
      .prepare('INSERT INTO notes (id,title,body,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run('n1', 'baru', 'b', 1, 1);
  } finally {
    source.close();
  }
}

const restoreChildScript = join(dir, 'orch-restore.cjs');
const readChildScript = join(dir, 'orch-read.cjs');

/** Anak proses: siapkan generasi lama, lalu jalankan restore penuh (opsional crash/fault). */
async function writeChildren() {
  await writeFile(
    restoreChildScript,
    [
      'const m = require(process.env.DB_MODULE);',
      'const { BackupService } = require(process.env.BACKUP_MODULE);',
      "const { mkdirSync, writeFileSync, rmSync, renameSync } = require('node:fs');",
      "const { join } = require('node:path');",
      'const dir = process.env.ST_DATA_DIR;',
      '// Generasi lama: akun pv=5 dan catatan keep.',
      `m.db.exec("INSERT INTO account (id,salt,hash,pv,must_change,secret,created_at) VALUES (1,'s','h',5,0,'x',1)");`,
      `m.db.exec("INSERT INTO notes (id,title,body,created_at,updated_at) VALUES ('keep','lama','b',1,1)");`,
      "mkdirSync(join(dir, 'uploads'), { recursive: true });",
      "writeFileSync(join(dir, 'uploads', 'lama.txt'), 'lama');",
      'const deps = {};',
      'let oldUploadRemovals = 0;',
      'const dbFile = join(dir, "super-tool.db");',
      "if (process.env.FAULT === 'cleanupUploads') {",
      '  deps.removeDir = (p) => {',
      "    if (p.endsWith('uploads.restore-old')) {",
      '      oldUploadRemovals += 1;',
      "      if (oldUploadRemovals >= 2) throw new Error('injected cleanup');",
      '    }',
      '    rmSync(p, { recursive: true, force: true });',
      '  };',
      '}',
      "if (process.env.FAULT === 'rollbackUploads') {",
      "  deps.open = () => { throw new Error('injected open'); };",
      '  deps.rename = (from, to) => {',
      "    if (from.endsWith('uploads.restore-old')) throw new Error('injected rollback uploads');",
      '    renameSync(from, to);',
      '  };',
      '}',
      "if (process.env.FAULT === 'rollbackDb') {",
      "  deps.open = () => { throw new Error('injected open'); };",
      '  deps.rename = (from, to) => {',
      "    if (from === dbFile + '.restore-old') throw new Error('injected rollback db');",
      '    renameSync(from, to);',
      '  };',
      '}',
      "if (process.env.FAULT === 'rollbackRemoveNew') {",
      "  deps.open = () => { throw new Error('injected open'); };",
      '  deps.remove = (p) => {',
      '    if (p === dbFile) throw new Error("injected rollback remove");',
      '    rmSync(p, { force: true });',
      '  };',
      '}',
      'if (process.env.FSYNC_FAIL_AT) {',
      '  const at = Number(process.env.FSYNC_FAIL_AT);',
      '  let calls = 0;',
      '  deps.fsyncDir = () => {',
      '    calls += 1;',
      "    if (calls === at) throw new Error('injected fsyncDir at ' + at);",
      '  };',
      '}',
      'if (process.env.CRASH_AT) {',
      '  deps.onPhase = (phase) => {',
      '    if (phase === process.env.CRASH_AT) process.exit(97);',
      '  };',
      '}',
      'new BackupService()',
      "  .restore({ originalname: 'orch.zip', path: process.env.ZIP, size: 1 }, deps)",
      "  .then(() => { console.log('OK'); })",
      "  .catch((err) => { console.log('THREW ' + (err && err.message)); process.exitCode = 3; });",
    ].join('\n'),
  );
  await writeFile(
    readChildScript,
    [
      'const m = require(process.env.DB_MODULE);',
      "const fs = require('node:fs');",
      "const { join } = require('node:path');",
      'const dir = process.env.ST_DATA_DIR;',
      "const notes = m.db.prepare('SELECT id FROM notes ORDER BY id').all().map((row) => row.id);",
      "const account = m.db.prepare('SELECT pv FROM account').get();",
      "const integrity = String(m.db.prepare('PRAGMA integrity_check').get().integrity_check);",
      "const ups = join(dir, 'uploads');",
      'const uploads = fs.existsSync(ups)',
      "  ? fs.readdirSync(ups).sort().map((name) => [name, fs.readFileSync(join(ups, name), 'utf8')])",
      '  : [];',
      'console.log(JSON.stringify({ notes, pv: account ? account.pv : null, integrity, uploads, files: fs.readdirSync(dir).sort() }));',
    ].join('\n'),
  );
}

function readState(dataDir) {
  const run = runNode(readChildScript, {
    ST_DATA_DIR: dataDir,
    DB_MODULE: dbModulePath,
    BACKUP_MODULE: backupModulePath,
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split('\n').filter(Boolean).at(-1));
}

function assertGeneration(state, expect, label) {
  assert.deepEqual(state.notes, expect.notes, label + ': catatan');
  assert.equal(state.pv, expect.pv, label + ': pv akun');
  assert.deepEqual(state.uploads, expect.uploads, label + ': isi uploads');
  assert.equal(state.integrity, 'ok', label + ': integritas database');
  assert.deepEqual(
    state.files.filter((name) => name.includes('.restore-')),
    [],
    label + ': artefak restore tersisa',
  );
}

async function orchestrations(name) {
  await writeChildren();
  const source = join(dir, 'orch-source-' + name + '.db');
  makeSourceDb(source, 1);
  const archive = await zip({
    'super-tool.db': await readFile(source),
    'uploads/new.txt': 'baru',
    'backup.json': '{}',
  });
  return archive;
}

test('restore: crash di setiap tahap menghasilkan database dan uploads dari generasi yang sama', async () => {
  const archive = await orchestrations('matrix');
  const oldGeneration = { notes: ['keep'], pv: 5, uploads: [['lama.txt', 'lama']] };
  const newGeneration = { notes: ['n1'], pv: 2, uploads: [['new.txt', 'baru']] };

  const scenarios = [
    // Journal dibuat, belum ada yang dipindah.
    { name: 'replacing', crashAt: 'replacing', expect: oldGeneration },
    // Uploads lama sudah dipindah, uploads baru belum terpasang.
    { name: 'uploads-moved', crashAt: 'uploads-moved', expect: oldGeneration },
    // Uploads baru aktif, database masih generasi lama.
    { name: 'uploads-installed', crashAt: 'uploads-installed', expect: oldGeneration },
    { name: 'old-moved', crashAt: 'old-moved', expect: oldGeneration },
    { name: 'installed', crashAt: 'installed', expect: oldGeneration },
    // Database baru lengkap termasuk pencabutan sesi, tetapi belum commit.
    { name: 'prepared', crashAt: 'prepared', expect: oldGeneration },
    // Commit durable; generasi baru harus dipertahankan.
    { name: 'committed', crashAt: 'committed', expect: newGeneration },
  ];

  for (const scenario of scenarios) {
    const work = await mkdtemp(join(tmpdir(), 'st-orch-' + scenario.name + '-'));
    const data = join(work, 'data');
    const zipPath = join(work, 'restore.zip');
    await writeFile(zipPath, archive);

    const crashed = runNode(restoreChildScript, {
      ST_DATA_DIR: data,
      DB_MODULE: dbModulePath,
      BACKUP_MODULE: backupModulePath,
      ZIP: zipPath,
      CRASH_AT: scenario.crashAt,
    });
    assert.equal(crashed.status, 97, 'anak harus berhenti di ' + scenario.name + ': ' + crashed.stderr);

    // Sebelum recovery, generasi lama harus masih tersedia di artefak.
    if (scenario.crashAt !== 'replacing') {
      const staleArtifacts = [join(data, 'super-tool.db.restore-old'), join(data, 'uploads.restore-old')].filter(
        (artifact) => existsSync(artifact),
      );
      assert.ok(staleArtifacts.length > 0, scenario.name + ': generasi lama harus tersimpan sebelum recovery');
    }

    // Dua kali recovery membuktikan hasilnya idempoten.
    assertGeneration(readState(data), scenario.expect, scenario.name + ' recovery #1');
    assertGeneration(readState(data), scenario.expect, scenario.name + ' recovery #2');
    await rm(work, { recursive: true, force: true });
  }
});

test('restore: kegagalan cleanup uploads pasca-commit dituntaskan startup', async () => {
  const archive = await orchestrations('cleanup');
  const work = await mkdtemp(join(tmpdir(), 'st-orch-cleanup-'));
  const data = join(work, 'data');
  const zipPath = join(work, 'restore.zip');
  await writeFile(zipPath, archive);

  const done = runNode(restoreChildScript, {
    ST_DATA_DIR: data,
    DB_MODULE: dbModulePath,
    BACKUP_MODULE: backupModulePath,
    ZIP: zipPath,
    FAULT: 'cleanupUploads',
  });
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /OK/);

  // Restore tetap commit; artefak dan journal dipertahankan untuk startup.
  assert.ok(existsSync(join(data, 'uploads.restore-old')), 'salinan uploads lama disimpan');
  assert.ok(existsSync(join(data, 'super-tool.db.restore-journal')), 'journal committed disimpan');

  const expected = { notes: ['n1'], pv: 2, uploads: [['new.txt', 'baru']] };
  assertGeneration(readState(data), expected, 'cleanup recovery #1');
  assertGeneration(readState(data), expected, 'cleanup recovery #2');
  assert.equal(existsSync(join(data, 'uploads.restore-old')), false, 'startup membersihkan salinan lama');
  await rm(work, { recursive: true, force: true });
});

test('restore: kegagalan rollback menghentikan proses dan dipulihkan startup', async () => {
  const archive = await orchestrations('rollback');
  const expected = { notes: ['keep'], pv: 5, uploads: [['lama.txt', 'lama']] };

  for (const fault of ['rollbackUploads', 'rollbackDb', 'rollbackRemoveNew']) {
    const work = await mkdtemp(join(tmpdir(), 'st-orch-' + fault + '-'));
    const data = join(work, 'data');
    const zipPath = join(work, 'restore.zip');
    await writeFile(zipPath, archive);

    const failed = runNode(restoreChildScript, {
      ST_DATA_DIR: data,
      DB_MODULE: dbModulePath,
      BACKUP_MODULE: backupModulePath,
      ZIP: zipPath,
      FAULT: fault,
    });
    assert.equal(failed.status, 1, fault + ' harus menghentikan proses: ' + failed.stderr);
    assert.match(failed.stderr, /rollback gagal/);
    assert.match(failed.stderr, /error asli/);
    assert.doesNotMatch(failed.stdout, /OK/, fault + ': tidak boleh melaporkan sukses');
    assert.ok(
      existsSync(join(data, 'super-tool.db.restore-journal')),
      fault + ': journal dipertahankan untuk startup',
    );

    // Proses berhenti sebelum request bisa dilanjutkan; startup baru memulihkan.
    assertGeneration(readState(data), expected, fault + ' recovery #1');
    assertGeneration(readState(data), expected, fault + ' recovery #2');
    await rm(work, { recursive: true, force: true });
  }
});


/** Folder data dengan database valid (pv tertentu) untuk menguji recovery journal. */
async function journalCase(name, pv = 5) {
  const work = await mkdtemp(join(tmpdir(), 'st-journal-' + name + '-'));
  const data = join(work, 'data');
  await mkdir(data, { recursive: true });
  const dbFile = join(data, 'super-tool.db');
  makeSourceDb(dbFile, pv);
  return { work, data, dbFile };
}

const writeJournal = (data, entry) =>
  writeFile(join(data, 'super-tool.db.restore-journal'), JSON.stringify(entry));

test('restore: committed dengan uploads baru dan salinan lama mempertahankan generasi baru', async () => {
  await writeChildren();
  const { work, data } = await journalCase('committed-ok');
  await mkdir(join(data, 'uploads'));
  await writeFile(join(data, 'uploads', 'new.txt'), 'baru');
  await mkdir(join(data, 'uploads.restore-old'));
  await writeFile(join(data, 'uploads.restore-old', 'lama.txt'), 'lama');
  await writeJournal(data, { phase: 'committed', uploads: true, hadUploads: true, at: 1 });

  const expected = { notes: ['n1'], pv: 5, uploads: [['new.txt', 'baru']] };
  assertGeneration(readState(data), expected, 'committed #1');
  assertGeneration(readState(data), expected, 'committed #2');
  assert.equal(existsSync(join(data, 'uploads.restore-old')), false, 'salinan lama dibersihkan');
  assert.equal(existsSync(join(data, 'super-tool.db.restore-journal')), false, 'journal dibersihkan');
  await rm(work, { recursive: true, force: true });
});

test('restore: committed tanpa folder uploads gagal startup dan mempertahankan artefak', async () => {
  await writeChildren();
  const { work, data, dbFile } = await journalCase('committed-missing');
  await mkdir(join(data, 'uploads.restore-old'));
  await writeFile(join(data, 'uploads.restore-old', 'lama.txt'), 'lama');
  await writeJournal(data, { phase: 'committed', uploads: true, hadUploads: true, at: 1 });
  const before = await readFile(dbFile);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const failed = runNode(readChildScript, { ST_DATA_DIR: data, DB_MODULE: dbModulePath });
    assert.notEqual(failed.status, 0, 'startup harus gagal (percobaan ' + attempt + ')');
    assert.match(failed.stderr, /Restore commit tidak lengkap: folder uploads hilang/);
    assert.deepEqual(await readFile(dbFile), before, 'database committed tidak diubah');
    assert.ok(existsSync(join(data, 'super-tool.db.restore-journal')), 'journal dipertahankan');
    assert.ok(existsSync(join(data, 'uploads.restore-old')), 'artefak uploads lama dipertahankan');
  }
  await rm(work, { recursive: true, force: true });
});

test(
  'restore: committed dengan pembersihan uploads gagal menahan journal sampai bersih',
  { skip: typeof process.getuid === 'function' && process.getuid() === 0 },
  async () => {
    await writeChildren();
    const { work, data } = await journalCase('committed-cleanup');
    await mkdir(join(data, 'uploads'));
    await writeFile(join(data, 'uploads', 'new.txt'), 'baru');
    const blocked = join(data, 'uploads.restore-old', 'blocked');
    await mkdir(blocked, { recursive: true });
    await writeFile(join(blocked, 'file.txt'), 'x');
    await chmod(blocked, 0o500);
    await writeJournal(data, { phase: 'committed', uploads: true, hadUploads: true, at: 1 });

    const expected = { notes: ['n1'], pv: 5, uploads: [['new.txt', 'baru']] };
    const first = readState(data);
    assert.deepEqual(first.notes, expected.notes, 'generasi tidak berubah');
    assert.deepEqual(first.uploads, expected.uploads, 'uploads baru tetap otoritatif');
    assert.ok(existsSync(join(data, 'super-tool.db.restore-journal')), 'journal ditahan saat cleanup gagal');

    const second = readState(data);
    assert.deepEqual(second.uploads, expected.uploads, 'recovery berulang idempoten');

    await chmod(blocked, 0o700);
    const recovered = readState(data);
    assert.deepEqual(recovered.uploads, expected.uploads, 'generasi tetap baru setelah cleanup');
    assert.equal(existsSync(join(data, 'super-tool.db.restore-journal')), false, 'journal hilang setelah bersih');
    assert.equal(existsSync(join(data, 'uploads.restore-old')), false, 'salinan lama terhapus');
    await rm(work, { recursive: true, force: true });
  },
);

test('restore: journal rusak atau ambigu menggagalkan startup tanpa menghapus artefak', async () => {
  await writeChildren();
  const cases = [
    { name: 'json', content: '{bukan json', match: /bukan JSON yang valid/ },
    { name: 'phase', content: '{"phase":"entah"}', match: /phase tidak dikenal/ },
    { name: 'tipe', content: '{"phase":"committed","uploads":"ya","hadUploads":true}', match: /harus boolean/ },
    { name: 'sepasang', content: '{"phase":"replacing","uploads":true}', match: /harus ada bersamaan/ },
    {
      name: 'kontradiksi',
      content: '{"phase":"replacing","uploads":false,"hadUploads":true}',
      match: /uploads=false tidak boleh/,
    },
    { name: 'at', content: '{"phase":"replacing","at":"x"}', match: /at harus angka/ },
  ];

  for (const item of cases) {
    const { work, data, dbFile } = await journalCase('invalid-' + item.name);
    const journalPath = join(data, 'super-tool.db.restore-journal');
    await writeFile(journalPath, item.content);
    const before = await readFile(dbFile);

    const failed = runNode(readChildScript, { ST_DATA_DIR: data, DB_MODULE: dbModulePath });
    assert.notEqual(failed.status, 0, item.name + ': startup harus gagal');
    assert.match(failed.stderr, item.match);
    assert.deepEqual(await readFile(dbFile), before, item.name + ': database tidak diubah');
    assert.equal(await readFile(journalPath, 'utf8'), item.content, item.name + ': journal dipertahankan');
    await rm(work, { recursive: true, force: true });
  }
});

test('restore: journal versi lama yang valid tetap dipulihkan', async () => {
  await writeChildren();

  // Replacing lama: swap uploads selesai sebelum journal, salinan lama dipulihkan.
  const replacing = await journalCase('legacy-replacing', 5);
  await copyFile(replacing.dbFile, replacing.dbFile + '.restore-old');
  const old = new DatabaseSync(replacing.dbFile + '.restore-old');
  old.exec('UPDATE account SET pv = 9');
  old.close();
  await writeJournal(replacing.data, { phase: 'replacing', at: 1 });
  assertGeneration(
    readState(replacing.data),
    { notes: ['n1'], pv: 9, uploads: [] },
    'legacy replacing',
  );
  await rm(replacing.work, { recursive: true, force: true });

  // Committed lama: uploads yang ada adalah generasi baru; salinan lama dibuang.
  const committed = await journalCase('legacy-committed', 5);
  await mkdir(join(committed.data, 'uploads'));
  await writeFile(join(committed.data, 'uploads', 'new.txt'), 'baru');
  await writeJournal(committed.data, { phase: 'committed', at: 1 });
  assertGeneration(
    readState(committed.data),
    { notes: ['n1'], pv: 5, uploads: [['new.txt', 'baru']] },
    'legacy committed',
  );
  await rm(committed.work, { recursive: true, force: true });
});

test('restore: kegagalan fsync direktori tidak pernah melaporkan sukses sebelum commit', async () => {
  const archive = await orchestrations('fsync');
  const oldGeneration = { notes: ['keep'], pv: 5, uploads: [['lama.txt', 'lama']] };
  const newGeneration = { notes: ['n1'], pv: 2, uploads: [['new.txt', 'baru']] };

  // 1 journal replacing, 2 uploads lama, 3 uploads baru, 4 DB lama,
  // 5 DB baru, 6 persiapan, 7 journal committed, 8 cleanup pasca-commit.
  const preCommit = [1, 2, 3, 4, 5, 6, 7];
  for (const at of preCommit) {
    const work = await mkdtemp(join(tmpdir(), 'st-fsync-' + at + '-'));
    const data = join(work, 'data');
    const zipPath = join(work, 'restore.zip');
    await writeFile(zipPath, archive);

    const failed = runNode(restoreChildScript, {
      ST_DATA_DIR: data,
      DB_MODULE: dbModulePath,
      BACKUP_MODULE: backupModulePath,
      ZIP: zipPath,
      FSYNC_FAIL_AT: String(at),
    });
    assert.equal(failed.status, 3, 'fsync #' + at + ' harus gagal: ' + failed.stderr);
    assert.doesNotMatch(failed.stdout, /OK/, 'fsync #' + at + ' tidak boleh sukses');
    assertGeneration(readState(data), oldGeneration, 'fsync #' + at + ' recovery');
    await rm(work, { recursive: true, force: true });
  }

  const work = await mkdtemp(join(tmpdir(), 'st-fsync-cleanup-'));
  const data = join(work, 'data');
  const zipPath = join(work, 'restore.zip');
  await writeFile(zipPath, archive);
  const done = runNode(restoreChildScript, {
    ST_DATA_DIR: data,
    DB_MODULE: dbModulePath,
    BACKUP_MODULE: backupModulePath,
    ZIP: zipPath,
    FSYNC_FAIL_AT: '8',
  });
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /OK/);
  assert.ok(existsSync(join(data, 'super-tool.db.restore-journal')), 'journal committed ditahan');
  assertGeneration(readState(data), newGeneration, 'fsync cleanup recovery #1');
  assertGeneration(readState(data), newGeneration, 'fsync cleanup recovery #2');
  assert.equal(existsSync(join(data, 'super-tool.db.restore-journal')), false, 'journal dibersihkan startup');
  await rm(work, { recursive: true, force: true });
});
