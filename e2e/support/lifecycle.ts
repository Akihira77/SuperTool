export type SpawnOutcome = 'spawn' | 'error';

/** Bagian dari ChildProcess yang dipakai lifecycle (memudahkan test dengan fake). */
export type ProcessHandle = {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  kill: (signal: NodeJS.Signals) => boolean;
};

export type ShutdownTarget = {
  process: ProcessHandle;
  /** Promise yang resolve saat event `exit` diterima. */
  exited: Promise<void>;
  /** Promise yang resolve sekali saat proses `spawn` atau gagal `error`. */
  spawnSettled: Promise<SpawnOutcome>;
};

export type ShutdownLimits = {
  spawnMs?: number;
  termMs?: number;
  killMs?: number;
};

const DEFAULT_LIMITS = { spawnMs: 5000, termMs: 5000, killMs: 5000 };

/** Timer dibatasi supaya tidak menahan proses test saat dipakai di race. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/** Tunggu event `exit`, tapi jangan menggantung kalau proses tidak pernah di-reap. */
export async function waitExit(exited: Promise<void>, ms: number): Promise<boolean> {
  return Promise.race([exited.then(() => true), delay(ms).then(() => false)]);
}

function pidOf(target: ShutdownTarget): string {
  return target.process.pid === undefined ? 'tanpa pid' : String(target.process.pid);
}

async function confirmExit(target: ShutdownTarget, pid: string, stage: string, ms: number): Promise<void> {
  if (await waitExit(target.exited, ms)) return;
  throw new Error(`Proses E2E (pid ${pid}) belum mengirim event 'exit' pada tahap ${stage} dalam ${ms} ms.`);
}

/**
 * Hentikan proses: tunggu status spawn, SIGTERM, tunggu exit, lalu SIGKILL dan
 * tunggu exit lagi. Kalau `exit` tidak pernah diterima setelah SIGKILL, fungsi
 * melempar error berisi pid dan tahap — pemanggil tidak boleh menganggap
 * pembersihan berhasil.
 */
export async function shutdownProcess(target: ShutdownTarget, limits: ShutdownLimits = {}): Promise<void> {
  const { spawnMs, termMs, killMs } = { ...DEFAULT_LIMITS, ...limits };
  const pid = pidOf(target);

  const outcome = await Promise.race([
    target.spawnSettled,
    delay(spawnMs).then(() => 'timeout' as const),
  ]);
  if (outcome === 'error') return;
  if (outcome === 'timeout') {
    throw new Error(`Proses E2E (pid ${pid}) tidak memicu 'spawn' atau 'error' dalam ${spawnMs} ms pada tahap spawn.`);
  }

  if (target.process.exitCode !== null || target.process.signalCode !== null) {
    await confirmExit(target, pid, 'sudah berhenti', killMs);
    return;
  }

  target.process.kill('SIGTERM');
  if (await waitExit(target.exited, termMs)) return;

  target.process.kill('SIGKILL');
  if (!(await waitExit(target.exited, killMs))) {
    throw new Error(`Proses E2E (pid ${pid}) belum mengirim event 'exit' dalam ${killMs} ms setelah SIGKILL.`);
  }
}

export type TempDirs = { dirs: string[]; cleanup: () => Promise<void> };

async function removeAll(dirs: string[], removeDir: (dir: string) => Promise<void>): Promise<void> {
  const failures: unknown[] = [];
  for (const dir of dirs) {
    try {
      await removeDir(dir);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, `Gagal menghapus ${failures.length} direktori sementara E2E`);
  }
}

/**
 * Buat direktori sementara satu per satu. Kalau salah satu gagal, direktori
 * yang sudah terlanjur dibuat ikut dihapus sebelum error asli dilempar.
 * `cleanup()` idempoten lewat memoisasi promise: panggilan berikutnya menerima
 * promise yang sama, termasuk rejection-nya, jadi kegagalan tidak berubah jadi
 * sukses palsu.
 */
export async function createTempDirs(
  makeDir: (prefix: string) => Promise<string>,
  prefixes: string[],
  removeDir: (dir: string) => Promise<void>,
): Promise<TempDirs> {
  const dirs: string[] = [];
  try {
    for (const prefix of prefixes) dirs.push(await makeDir(prefix));
  } catch (error) {
    const rollbackError = await removeAll(dirs, removeDir).then(
      () => null,
      (reason: unknown) => reason,
    );
    throw combineErrors(error, rollbackError);
  }

  const cleanup = createIdempotent(() => removeAll(dirs, removeDir));
  return { dirs, cleanup };
}

/** Gabungkan dua error tanpa membuang salah satu; error utama tetap pesan & objeknya. */
export function combineErrors(primary: unknown, secondary: unknown): unknown {
  if (!secondary) return primary;
  if (!primary) return secondary;
  const message = primary instanceof Error ? primary.message : String(primary);
  return new AggregateError([primary, secondary], message);
}

/** Jalankan sekali saja; panggilan berikutnya menerima promise yang sama (termasuk rejection). */
export function createIdempotent<T>(run: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) pending = run();
    return pending;
  };
}

