import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const sandbox = await mkdtemp(join(tmpdir(), 'st-ws-'));
const data = join(sandbox, 'data');
const root = join(sandbox, 'proyek');
await mkdir(data, { recursive: true });
await mkdir(root, { recursive: true });
await mkdir(join(root, '.git'), { recursive: true });
await writeFile(join(root, '.env'), 'SECRET=jangan-disimpan');
process.env.ST_DATA_DIR = data;
process.env.ST_FS_ROOTS = root;

const { WorkspacesService } = await import('./dist/modules/workspaces/workspaces.service.js');
const service = new WorkspacesService();

test('workspace: buat, ubah nama, dan root divalidasi', async () => {
  const created = await service.save({
    name: '  Proyek A  ',
    root,
    config: {
      gitRepo: root,
      favoriteUrls: ['http://127.0.0.1:3001'],
      tools: ['files', 'git'],
      services: [{ name: 'API', url: 'http://127.0.0.1:3001' }],
      shortcuts: [{ label: 'API', path: root }],
    },
  });
  assert.equal(created.name, 'Proyek A');
  assert.equal(created.root, root);
  assert.deepEqual(created.config.favoriteUrls, ['http://127.0.0.1:3001/']);
  assert.equal(service.list().length, 1);

  const renamed = await service.save({ id: created.id, name: 'Proyek B', root, config: {} });
  assert.equal(renamed.name, 'Proyek B');
  assert.equal(renamed.id, created.id);
});

test('workspace: root di luar ST_FS_ROOTS ditolak', async () => {
  await assert.rejects(() => service.save({ name: 'Luar', root: '/etc' }), /di luar area/);
});

test('workspace: root yang tidak ada dan gitRepo bukan folder ditolak', async () => {
  await assert.rejects(() => service.save({ name: 'Hilang', root: join(root, 'tidak-ada') }), /tidak ditemukan/);
  await assert.rejects(() => service.save({ name: 'Git', root, config: { gitRepo: join(root, 'file.txt') } }), /tidak ditemukan/);
});

test('workspace: kunci env diabaikan dan tidak pernah tersimpan', async () => {
  const item = await service.save({
    name: 'Aman',
    root,
    config: { env: { SECRET: 'x' }, envFile: '.env', favoriteUrls: ['https://example.com'] },
  });
  assert.equal('env' in item.config, false);
  assert.equal('envFile' in item.config, false);
  const raw = JSON.stringify(service.list());
  assert.equal(raw.includes('SECRET'), false);
  assert.equal(raw.includes('jangan-disimpan'), false);
});

test('workspace: duplikat, ekspor, hapus, lalu impor', async () => {
  const copy = await service.duplicate(service.list()[0].id);
  assert.match(copy.name, /salinan/);
  const exported = service.exportData();
  assert.equal(exported.version, 1);
  assert.ok(exported.workspaces.length >= 2);

  service.remove(copy.id);
  const before = service.list().length;
  const result = await service.importData(exported);
  assert.equal(result.imported, exported.workspaces.length - before);
  assert.equal(result.skipped, before);
  assert.deepEqual(result.errors, []);
  assert.equal(service.list().length, exported.workspaces.length);
});

test('workspace: impor versi asing ditolak', async () => {
  await assert.rejects(() => service.importData({ version: 2, workspaces: [] }), /Versi impor/);
  await assert.rejects(() => service.importData({ version: 1, workspaces: new Array(51).fill({}) }), /Maksimal 50/);
});
