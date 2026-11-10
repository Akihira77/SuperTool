import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = await mkdtemp(join(tmpdir(), 'st-http-'));
process.env.ST_DATA_DIR = dir;

const { HttpStoreService } = await import('./dist/modules/dev/http-store.service.js');
const store = new HttpStoreService();

after(() => rm(dir, { recursive: true, force: true }));

test('http: request tersimpan dan header sensitif dikosongkan', () => {
  const saved = store.save({
    name: 'Health',
    method: 'GET',
    url: 'http://127.0.0.1:3001/api/health',
    headers: [
      { key: 'Accept', value: 'application/json' },
      { key: 'Authorization', value: 'Bearer rahasia' },
    ],
    body: '',
  });
  assert.equal(saved.name, 'Health');
  assert.equal(saved.headers.length, 2);
  assert.equal(saved.headers[1].key, 'Authorization');
  assert.equal(saved.headers[1].value, '');
  assert.equal(store.list('health').length, 1);
});

test('http: koleksi menghitung request dan delete melepas referensi', () => {
  const collection = store.saveCollection({ name: 'Lokal' });
  const saved = store.list()[0];
  store.save({ id: saved.id, name: saved.name, method: saved.method, url: saved.url, headers: saved.headers, body: '', collectionId: collection.id });
  assert.equal(store.collections()[0].count, 1);
  store.removeCollection(collection.id);
  assert.equal(store.get(saved.id).collectionId, null);
});

test('http: environment memvalidasi nama variabel dan menyimpan nilai', () => {
  const env = store.saveEnvironment({ name: 'Dev', variables: [{ key: 'baseUrl', value: 'http://localhost:3001' }] });
  assert.equal(env.variables[0].value, 'http://localhost:3001');
  assert.throws(() => store.saveEnvironment({ name: 'Rusak', variables: [{ key: '1bad', value: 'x' }] }), /Nama variabel tidak valid/);
  assert.equal(store.environments().length, 1);
});

test('http: riwayat dibatasi dan bisa dibersihkan', () => {
  for (let index = 0; index < 205; index += 1) {
    store.record({ method: 'GET', url: 'http://127.0.0.1:3001/x/' + index, status: 200, durationMs: 3, size: 10 });
  }
  const rows = store.history(200);
  assert.equal(rows.length, 100);
  assert.equal(rows[0].url, 'http://127.0.0.1:3001/x/204');
  store.clearHistory();
  assert.equal(store.history().length, 0);
});
