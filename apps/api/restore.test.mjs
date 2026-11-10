import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
