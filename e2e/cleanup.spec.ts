import { EventEmitter } from 'node:events';
import { expect, test } from '@playwright/test';
import {
  combineErrors,
  createIdempotent,
  createTempDirs,
  shutdownProcess,
  type ProcessHandle,
  type SpawnOutcome,
} from './support/lifecycle';

type Mode = 'sigterm' | 'sigkill' | 'stuck' | 'spawn-error' | 'already-exited' | 'never-spawns';

/** Child palsu: perilaku kill/exit ditentukan mode, tanpa proses OS nyata. */
function fakeChild(mode: Mode) {
  const events = new EventEmitter();
  const kills: NodeJS.Signals[] = [];
  let exitCode: number | null = null;

  const process: ProcessHandle = {
    pid: 4321,
    get exitCode() {
      return exitCode;
    },
    signalCode: null,
    kill(signal) {
      kills.push(signal);
      if ((mode === 'sigterm' && signal === 'SIGTERM') || (mode === 'sigkill' && signal === 'SIGKILL')) {
        exitCode = 0;
        events.emit('exit');
      }
      return true;
    },
  };

  const exited = new Promise<void>((resolve) => events.once('exit', () => resolve()));
  const spawnSettled = new Promise<SpawnOutcome>((resolve) => {
    if (mode === 'spawn-error') {
      queueMicrotask(() => resolve('error'));
      return;
    }
    if (mode === 'never-spawns') return;
    if (mode === 'already-exited') {
      queueMicrotask(() => {
        exitCode = 0;
        events.emit('exit');
        resolve('spawn');
      });
      return;
    }
    queueMicrotask(() => resolve('spawn'));
  });

  return { process, exited, spawnSettled, kills };
}

const FAST = { spawnMs: 80, termMs: 25, killMs: 25 };

test('cleanup: SIGTERM normal menyelesaikan shutdown tanpa SIGKILL', async () => {
  const child = fakeChild('sigterm');
  await shutdownProcess({ process: child.process, exited: child.exited, spawnSettled: child.spawnSettled }, FAST);
  expect(child.kills).toEqual(['SIGTERM']);
});

test('cleanup: SIGTERM diabaikan lalu SIGKILL berhasil', async () => {
  const child = fakeChild('sigkill');
  await shutdownProcess({ process: child.process, exited: child.exited, spawnSettled: child.spawnSettled }, FAST);
  expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
});

test('cleanup: SIGKILL tanpa event exit melempar error berisi pid dan tahap', async () => {
  const child = fakeChild('stuck');
  const error = await shutdownProcess(
    { process: child.process, exited: child.exited, spawnSettled: child.spawnSettled },
    FAST,
  ).then(
    () => null,
    (reason: Error) => reason,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error?.message).toContain('pid 4321');
  expect(error?.message).toContain('SIGKILL');
  expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
});

test('cleanup: spawn error sebelum proses jalan tidak memicu kill', async () => {
  const child = fakeChild('spawn-error');
  await shutdownProcess({ process: child.process, exited: child.exited, spawnSettled: child.spawnSettled }, FAST);
  expect(child.kills).toEqual([]);
});

test('cleanup: proses yang sudah berhenti tidak dikirimi sinyal', async () => {
  const child = fakeChild('already-exited');
  await shutdownProcess({ process: child.process, exited: child.exited, spawnSettled: child.spawnSettled }, FAST);
  expect(child.kills).toEqual([]);
});

test('cleanup: proses yang tak pernah spawn ditolak, bukan dianggap selesai', async () => {
  const child = fakeChild('never-spawns');
  const error = await shutdownProcess(
    { process: child.process, exited: child.exited, spawnSettled: child.spawnSettled },
    FAST,
  ).then(
    () => null,
    (reason: Error) => reason,
  );
  expect(error?.message).toContain('spawn');
  expect(child.kills).toEqual([]);
});

test('cleanup: stop berulang menjalankan shutdown sekali dan melempar error yang sama', async () => {
  const child = fakeChild('stuck');
  const stop = createIdempotent(() =>
    shutdownProcess({ process: child.process, exited: child.exited, spawnSettled: child.spawnSettled }, FAST),
  );

  const first = await stop().then(
    () => null,
    (reason: unknown) => reason,
  );
  const second = await stop().then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(first).toBeInstanceOf(Error);
  expect(second).toBe(first);
  expect(child.kills).toEqual(['SIGTERM', 'SIGKILL']);
});

test('cleanup: mkdtemp gagal di direktori kedua menghapus direktori pertama', async () => {
  const removed: string[] = [];
  let calls = 0;
  const error = await createTempDirs(
    async (prefix) => {
      calls += 1;
      if (calls === 2) throw new Error('mkdtemp gagal');
      return `/tmp/${prefix}${calls}`;
    },
    ['a-', 'b-', 'c-'],
    async (dir) => {
      removed.push(dir);
    },
  ).then(
    () => null,
    (reason: Error) => reason,
  );

  expect(error?.message).toBe('mkdtemp gagal');
  expect(removed).toEqual(['/tmp/a-1']);
});

test('cleanup: mkdtemp gagal di direktori ketiga menghapus dua direktori sebelumnya', async () => {
  const removed: string[] = [];
  let calls = 0;
  const error = await createTempDirs(
    async (prefix) => {
      calls += 1;
      if (calls === 3) throw new Error('mkdtemp gagal');
      return `/tmp/${prefix}${calls}`;
    },
    ['a-', 'b-', 'c-'],
    async (dir) => {
      removed.push(dir);
    },
  ).then(
    () => null,
    (reason: Error) => reason,
  );

  expect(error?.message).toBe('mkdtemp gagal');
  expect(removed).toEqual(['/tmp/a-1', '/tmp/b-2']);
});

test('cleanup: kegagalan rollback digabung dengan error pembuatan direktori', async () => {
  const error = await createTempDirs(
    async (prefix) => {
      if (prefix === 'b-') throw new Error('mkdtemp gagal');
      return `/tmp/${prefix}`;
    },
    ['a-', 'b-'],
    async () => {
      throw new Error('rm gagal');
    },
  ).then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors.map((entry) => (entry as Error).message)).toEqual([
    'mkdtemp gagal',
    'rm gagal',
  ]);
});

test('cleanup: cleanup() idempoten menghapus tiap direktori sekali', async () => {
  const removed: string[] = [];
  const { dirs, cleanup } = await createTempDirs(
    async (prefix) => `/tmp/${prefix}`,
    ['a-', 'b-', 'c-'],
    async (dir) => {
      removed.push(dir);
    },
  );
  await cleanup();
  await cleanup();
  expect(dirs).toEqual(['/tmp/a-', '/tmp/b-', '/tmp/c-']);
  expect(removed).toEqual(['/tmp/a-', '/tmp/b-', '/tmp/c-']);
});

test('cleanup: error startup tetap terbawa saat cleanup juga gagal', () => {
  const startup = new Error('Gagal start API: API berhenti saat start');
  const cleanupError = new Error('rm gagal');
  const combined = combineErrors(startup, cleanupError);

  expect(combined).toBeInstanceOf(AggregateError);
  expect((combined as AggregateError).errors).toEqual([startup, cleanupError]);
  expect((combined as Error).message).toBe('Gagal start API: API berhenti saat start');
});
