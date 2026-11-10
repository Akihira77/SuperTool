import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Modul db membuat database saat diimpor, jadi arahkan ke folder sementara
// sebelum impor dinamis.
const dir = await mkdtemp(join(tmpdir(), 'st-jobs-'));
process.env.ST_DATA_DIR = dir;
process.env.ST_JOB_CONCURRENCY = '1';

const { JobsService } = await import('./dist/modules/jobs/jobs.service.js');
const { createRequire } = await import('node:module');
const { run, one } = createRequire(import.meta.url)('./dist/common/db.js');

after(() => rm(dir, { recursive: true, force: true }));

async function waitFor(fn, accept, timeout = 4000) {
  const until = Date.now() + timeout;
  for (;;) {
    const value = fn();
    if (accept(value)) return value;
    if (Date.now() > until) throw new Error('timeout menunggu job: ' + JSON.stringify(value));
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('job: queued berjalan sampai completed', async () => {
  const jobs = new JobsService();
  jobs.onModuleInit();
  jobs.register('test:ok', {
    run: async (payload, ctx) => {
      ctx.progress(40);
      return { echo: payload.x };
    },
  });
  const started = jobs.start('test:ok', { x: 7 }, { label: 'ok' });
  assert.equal(started.status, 'queued');
  const done = await waitFor(() => jobs.get(started.id), (job) => job.status === 'completed');
  assert.equal(done.progress, 100);
  assert.deepEqual(done.result, { echo: 7 });
  assert.equal(done.label, 'ok');
  jobs.onModuleDestroy();
});

test('job: dedupe mengembalikan job aktif yang sama', async () => {
  const jobs = new JobsService();
  jobs.onModuleInit();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  jobs.register('test:gate', { run: async () => { await gate; return true; } });
  const first = jobs.start('test:gate', {}, { dedupeKey: 'same' });
  const second = jobs.start('test:gate', {}, { dedupeKey: 'same' });
  assert.equal(second.id, first.id);
  release();
  await waitFor(() => jobs.get(first.id), (job) => job.status === 'completed');
  jobs.onModuleDestroy();
});

test('job: cancel pada job queued', async () => {
  const jobs = new JobsService();
  jobs.onModuleInit();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  jobs.register('test:block', { run: async () => { await gate; return 1; } });
  jobs.register('test:ok', { run: async () => true });
  const first = jobs.start('test:block', {});
  await waitFor(() => jobs.get(first.id), (job) => job.status === 'running');
  const second = jobs.start('test:ok', {});
  const cancelled = jobs.cancel(second.id);
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.error ?? '', /Dibatalkan/);
  release();
  await waitFor(() => jobs.get(first.id), (job) => job.status === 'completed');
  jobs.onModuleDestroy();
});

test('job: handler error menjadi failed', async () => {
  const jobs = new JobsService();
  jobs.onModuleInit();
  jobs.register('test:fail', { run: async () => { throw new Error('boom'); } });
  const started = jobs.start('test:fail', {});
  const failed = await waitFor(() => jobs.get(started.id), (job) => job.status === 'failed');
  assert.equal(failed.error, 'boom');
  jobs.onModuleDestroy();
});

test('job: cancel job running yang cancellable', async () => {
  const jobs = new JobsService();
  jobs.onModuleInit();
  jobs.register('test:cancel', {
    cancellable: true,
    run: (_payload, ctx) =>
      new Promise((_resolve, reject) => {
        const stop = () => reject(new Error('aborted'));
        if (ctx.signal.aborted) stop();
        else ctx.signal.addEventListener('abort', stop, { once: true });
      }),
  });
  const started = jobs.start('test:cancel', {});
  await waitFor(() => jobs.get(started.id), (job) => job.status === 'running');
  jobs.cancel(started.id);
  const cancelled = await waitFor(() => jobs.get(started.id), (job) => job.status === 'cancelled');
  assert.equal(cancelled.cancellable, true);
  jobs.onModuleDestroy();
});

test('job: status running dari proses lama ditandai failed saat startup', () => {
  const now = Date.now();
  run(
    "INSERT INTO jobs (id, type, label, status, progress, created_at, started_at, payload, cancellable) VALUES ('stale', 'x', 'stale', 'running', 0, ?, ?, '{}', 0)",
    now,
    now,
  );
  const jobs = new JobsService();
  jobs.onModuleInit();
  const stale = jobs.get('stale');
  assert.equal(stale.status, 'failed');
  assert.match(stale.error ?? '', /server restart/);
  jobs.onModuleDestroy();
});

test('job: prune menyisakan 200 job terminal terbaru', () => {
  const base = Date.now() - 1000;
  for (let i = 0; i < 205; i += 1) {
    run(
      "INSERT INTO jobs (id, type, label, status, progress, created_at, completed_at, payload, cancellable) VALUES (?, 'x', 'old', 'completed', 100, ?, ?, '{}', 0)",
      'old-' + i,
      base + i,
      base + i,
    );
  }
  const jobs = new JobsService();
  jobs.onModuleInit();
  const kept = one("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('completed','failed','cancelled')");
  assert.equal(kept.n, 200);
  const total = one('SELECT COUNT(*) AS n FROM jobs');
  assert.ok(total.n <= 201, 'job non-terminal boleh tersisa, terminal dibatasi 200');
  jobs.onModuleDestroy();
});
