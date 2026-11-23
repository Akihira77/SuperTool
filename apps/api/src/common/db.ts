import { DatabaseSync } from 'node:sqlite';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from '../config';
import { notifyDatabaseReplaced } from './db-events';

/**
 * Semua data aplikasi (akun, catatan, daftar URL, path yang pernah dibuka)
 * disimpan di satu database SQLite. Isi file (nginx, file explorer) tetap di
 * disk — database hanya mencatat path-nya.
 * ponytail: node:sqlite bawaan Node, tanpa dependensi tambahan.
 */
const file = join(cfg.dataDir, 'super-tool.db');
mkdirSync(cfg.dataDir, { recursive: true });

/** Versi skema yang dipahami build ini; backup dengan versi lebih baru ditolak. */
export const SCHEMA_VERSION = 1;

/** Kolom minimum yang dipakai modul aplikasi; DB lama tanpa kolom ini ditolak. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  account: ['id', 'salt', 'hash', 'pv', 'must_change', 'secret', 'created_at'],
  notes: ['id', 'title', 'body', 'created_at', 'updated_at'],
  urls: ['id', 'name', 'url', 'proxy', 'created_at'],
};

// Skema ringan untuk workspace (metadata proyek, bukan akun terpisah).
const WORKSPACE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    root TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workspaces_updated ON workspaces(updated_at DESC);
`;

// Skema ringan untuk HTTP workspace (koleksi, environment, riwayat).
const HTTP_SCHEMA = `
  CREATE TABLE IF NOT EXISTS http_collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS http_requests (
    id TEXT PRIMARY KEY,
    collection_id TEXT,
    name TEXT NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    headers TEXT NOT NULL DEFAULT '[]',
    body TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (collection_id) REFERENCES http_collections(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_http_requests_updated ON http_requests(updated_at DESC);
  CREATE TABLE IF NOT EXISTS http_environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    variables TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS http_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    status INTEGER,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL DEFAULT 0,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_http_history_ts ON http_history(ts DESC);
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;


const restoreOld = file + '.restore-old';
const restoreIncoming = file + '.restore-new';
const restoreJournal = file + '.restore-journal';
const uploadsDir = join(cfg.dataDir, 'uploads');
const uploadsOld = uploadsDir + '.restore-old';

/**
 * Journal restore. Satu journal mengikat database dan folder uploads ke satu
 * transaksi. `uploads` mencatat apakah arsip membawa folder uploads, dan
 * `hadUploads` apakah folder lama ada saat transaksi dimulai. Recovery butuh
 * keduanya untuk membedakan "swap belum jalan" dari "swap selesai".
 */
type RestoreJournal = {
  phase: 'replacing' | 'committed';
  uploads?: boolean;
  hadUploads?: boolean;
};

function removeQuiet(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // best-effort: journal akan memaksa percobaan ulang saat startup
  }
}

function removeDirQuiet(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    // sama seperti removeQuiet; state transaksi tetap ditentukan journal
  }
}

/** Hapus artefak; `false` berarti masih ada sisa yang harus diulang startup. */
function removeChecked(path: string): boolean {
  try {
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

function removeDirChecked(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Buang folder staging `.restore-*` milik restore yang mati di tengah jalan.
 * Hanya dipanggil setelah recovery selesai, saat tidak ada restore aktif.
 */
function removeStaleStages(): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(cfg.dataDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith('.restore-')) removeDirQuiet(join(cfg.dataDir, name));
  }
}

/**
 * Baca journal dengan validasi ketat. Journal rusak atau ambigu tidak boleh
 * ditebak: bisa saja transaksinya sudah commit, jadi startup harus gagal dan
 * artefak dipertahankan untuk diagnosis. Format versi lama (`{ phase, at }`)
 * tetap diterima tanpa field uploads.
 */
function readRestoreJournal(): RestoreJournal | null {
  if (!existsSync(restoreJournal)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(restoreJournal, 'utf8'));
  } catch {
    throw new Error('Journal restore rusak: bukan JSON yang valid (' + restoreJournal + ')');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Journal restore rusak: struktur harus objek (' + restoreJournal + ')');
  }

  const raw = parsed as Record<string, unknown>;
  if (raw.phase !== 'replacing' && raw.phase !== 'committed') {
    throw new Error('Journal restore rusak: phase tidak dikenal (' + String(raw.phase) + ')');
  }
  const hasUploads = Object.prototype.hasOwnProperty.call(raw, 'uploads');
  const hasHadUploads = Object.prototype.hasOwnProperty.call(raw, 'hadUploads');
  if (hasUploads !== hasHadUploads) {
    throw new Error('Journal restore rusak: uploads dan hadUploads harus ada bersamaan');
  }
  if (hasUploads && (typeof raw.uploads !== 'boolean' || typeof raw.hadUploads !== 'boolean')) {
    throw new Error('Journal restore rusak: uploads dan hadUploads harus boolean');
  }
  if (raw.uploads === false && raw.hadUploads === true) {
    throw new Error('Journal restore rusak: uploads=false tidak boleh punya hadUploads=true');
  }
  if ('at' in raw && (typeof raw.at !== 'number' || !Number.isFinite(raw.at))) {
    throw new Error('Journal restore rusak: at harus angka');
  }

  return {
    phase: raw.phase,
    uploads: hasUploads ? (raw.uploads as boolean) : undefined,
    hadUploads: hasUploads ? (raw.hadUploads as boolean) : undefined,
  };
}

/** Errcode "filesystem tidak mendukung fsync direktori", bukan kegagalan I/O. */
const FSYNC_DIR_UNSUPPORTED = new Set(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR']);
let fsyncDirWarned = false;

/**
 * Sinkronkan metadata direktori setelah rename. Linux mendukung fsync direktori;
 * platform lain (umumnya Windows) menolak dengan EINVAL/EISDIR, dan untuk itu
 * durability metadata bergantung pada filesystem. Kegagalan I/O nyata (EIO,
 * ENOSPC, ...) dilempar supaya restore tidak mengklaim commit yang tidak durable.
 */
function fsyncDir(path: string): void {
  let fd: number;
  try {
    fd = openSync(path, 'r');
  } catch (err) {
    if (FSYNC_DIR_UNSUPPORTED.has((err as NodeJS.ErrnoException).code ?? '')) {
      if (!fsyncDirWarned) {
        fsyncDirWarned = true;
        process.stderr.write('restore: fsync direktori tidak didukung; durability metadata mengikuti filesystem\n');
      }
      return;
    }
    throw err;
  }
  try {
    fsyncSync(fd);
  } catch (err) {
    if (!FSYNC_DIR_UNSUPPORTED.has((err as NodeJS.ErrnoException).code ?? '')) throw err;
  } finally {
    closeSync(fd);
  }
}

/**
 * Tulis journal baru secara atomik: tmp -> fsync file -> rename. Dipisahkan
 * dari konfirmasi durability direktori supaya pemanggil bisa membedakan
 * "journal belum terpasang" (rollback aman) dari "journal terpasang tetapi
 * durability belum terkonfirmasi" (keputusan harus fail-closed).
 */
function installRestoreJournal(entry: RestoreJournal): void {
  const tmp = restoreJournal + '.tmp';
  writeFileSync(tmp, JSON.stringify({ ...entry, at: Date.now() }), { encoding: 'utf8', mode: 0o600 });
  const fd = openSync(tmp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, restoreJournal);
}

/** Tulis journal untuk fase yang belum commit; kegagalan = belum ada perubahan aktif. */
function writeRestoreJournal(entry: RestoreJournal, sync: (path: string) => void = fsyncDir): void {
  installRestoreJournal(entry);
  sync(cfg.dataDir);
}

function removeRestoreJournal(): void {
  rmSync(restoreJournal, { force: true });
  removeQuiet(restoreJournal + '.tmp');
  fsyncDir(cfg.dataDir);
}

/**
 * Database yang tercatat commit harus benar-benar ada dan valid sebelum
 * artefak lama dibuang. `new DatabaseSync(file)` tidak dipakai di sini karena
 * pada file yang hilang ia membuat database kosong; validasi memakai mode
 * read-only sehingga kerusakan tidak berubah menjadi database baru palsu.
 */
function assertCommittedDatabase(): void {
  if (!existsSync(file)) {
    throw new Error('Restore commit tidak lengkap: database aktif hilang (' + file + '); artefak dipertahankan');
  }
  try {
    validateDatabaseFile(file);
  } catch (err) {
    throw new Error(
      'Restore commit tidak valid: ' + (err as Error).message + ' (' + file + '); artefak dipertahankan',
    );
  }
}

/**
 * Pulihkan database + uploads yang terputus (crash/SIGKILL) ke satu generasi.
 * - committed: database dan uploads baru otoritatif; salinan lama dibuang.
 * - replacing: keduanya dikembalikan ke generasi lama.
 * Journal yang rusak/ambigu tidak ditebak: recovery melempar error sehingga
 * startup gagal dengan artefak dan journal utuh untuk diagnosis.
 * Journal versi lama tidak menyimpan status uploads; untuk itu swap uploads
 * dianggap selesai bila salinan lama ada (urutan versi lama: swap dulu, journal
 * kemudian), sehingga salinan lama dipulihkan.
 */
export function recoverInterruptedRestore(): void {
  const journal = readRestoreJournal();

  if (!journal) {
    // Kompatibilitas proses versi lama yang belum memakai journal.
    if (!existsSync(file) && existsSync(restoreOld)) renameSync(restoreOld, file);
    // Journal dihapus paling akhir; tanpa journal, salinan lama hanya sisa
    // pembersihan pasca-commit dan aman dibuang selama file aktif ada.
    else if (existsSync(file)) removeQuiet(restoreOld);
    removeQuiet(restoreIncoming);
    // Swap uploads versi lama berjalan sebelum journal; folder yang hilang
    // berarti restore terputus dan salinan lamanya harus dipasang kembali.
    if (!existsSync(uploadsDir) && existsSync(uploadsOld)) renameSync(uploadsOld, uploadsDir);
    removeStaleStages();
    return;
  }

  if (journal.phase === 'committed') {
    // Jangan menyentuh artefak sebelum database committed terbukti ada & valid.
    assertCommittedDatabase();
    let cleanupOk = true;
    if (journal.uploads === undefined) {
      // Journal versi lama: tidak menyimpan status uploads. Salinan lama yang
      // ada tanpa folder aktif berarti swap terputus di tengah; jangan menebak,
      // biarkan startup gagal dengan artefak utuh.
      if (!existsSync(uploadsDir) && existsSync(uploadsOld)) {
        throw new Error(
          'Journal restore versi lama ambigu: uploads hilang tetapi salinan lama ada (' + uploadsOld + ')',
        );
      }
      cleanupOk = removeDirChecked(uploadsOld) && cleanupOk;
    } else if (journal.uploads) {
      // Transaksi sudah commit: uploads baru otoritatif. Memasang balik salinan
      // lama akan menghasilkan database baru dengan uploads lama, jadi folder
      // yang hilang dianggap kerusakan dan startup harus gagal.
      if (!existsSync(uploadsDir)) {
        throw new Error(
          'Restore commit tidak lengkap: folder uploads hilang (' + uploadsDir + '); artefak dipertahankan',
        );
      }
      cleanupOk = removeDirChecked(uploadsOld) && cleanupOk;
    } else {
      // Arsip tanpa uploads: folder lama tidak pernah ditukar oleh transaksi ini.
      cleanupOk = removeDirChecked(uploadsOld) && cleanupOk;
    }
    cleanupOk = removeChecked(restoreOld) && cleanupOk;
    cleanupOk = removeChecked(restoreIncoming) && cleanupOk;
    if (!cleanupOk) {
      process.stderr.write(
        'restore: pembersihan pasca-commit belum selesai; journal dipertahankan untuk startup berikutnya\n',
      );
      return;
    }
    removeRestoreJournal();
    removeStaleStages();
    return;
  }

  // Belum commit: database lama yang otoritatif.
  if (existsSync(restoreOld)) {
    removeQuiet(file);
    removeQuiet(file + '-wal');
    removeQuiet(file + '-shm');
    renameSync(restoreOld, file);
  } else if (!existsSync(file)) {
    if (existsSync(restoreIncoming)) renameSync(restoreIncoming, file);
    else throw new Error('Restore database terputus dan tidak ada salinan database yang bisa dipulihkan');
  }
  removeQuiet(restoreIncoming);

  if (journal.uploads === true) {
    if (journal.hadUploads === false) {
      // Tidak ada folder sebelumnya, jadi folder yang ada pasti hasil restore
      // yang gagal dan harus dibuang agar cocok dengan database lama.
      if (existsSync(uploadsDir)) rmSync(uploadsDir, { recursive: true, force: true });
    } else if (existsSync(uploadsOld)) {
      // Swap sempat berjalan: buang uploads baru, pasang kembali yang lama.
      rmSync(uploadsDir, { recursive: true, force: true });
      renameSync(uploadsOld, uploadsDir);
    }
  } else if (journal.uploads === undefined && existsSync(uploadsOld)) {
    // Journal versi lama: swap selalu selesai sebelum journal ditulis.
    rmSync(uploadsDir, { recursive: true, force: true });
    renameSync(uploadsOld, uploadsDir);
  }

  removeRestoreJournal();
  removeStaleStages();
}

recoverInterruptedRestore();

export let db = new DatabaseSync(file);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
// WAL membolehkan pembaca (SQLite Viewer) jalan bersamaan dengan penulis.
// busy_timeout mencegah "database is locked" saat keduanya bertabrakan sesaat.
db.exec('PRAGMA busy_timeout = 5000');
db.exec('PRAGMA synchronous = NORMAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    pv INTEGER NOT NULL DEFAULT 1,
    must_change INTEGER NOT NULL DEFAULT 1,
    secret TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
  CREATE TABLE IF NOT EXISTS urls (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    proxy INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recent_paths (
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    PRIMARY KEY (kind, path)
  );
  CREATE INDEX IF NOT EXISTS idx_recent ON recent_paths(kind, opened_at DESC);
  CREATE TABLE IF NOT EXISTS google_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expiry INTEGER,
    scope TEXT,
    token_type TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS storage_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL,
    scanned_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    source TEXT NOT NULL,
    actor TEXT NOT NULL,
    feature TEXT NOT NULL,
    action TEXT NOT NULL,
    method TEXT,
    path TEXT,
    status INTEGER,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    ip TEXT,
    user_agent TEXT,
    payload TEXT,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_log(source, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_feature ON audit_log(feature, ts DESC);
  CREATE TABLE IF NOT EXISTS compare_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    left_text TEXT NOT NULL,
    right_text TEXT NOT NULL,
    left_lines INTEGER NOT NULL DEFAULT 0,
    right_lines INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_compare_created ON compare_history(id DESC);
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    error TEXT,
    result TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    cancellable INTEGER NOT NULL DEFAULT 0,
    dedupe_key TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key, status);
`);
db.exec(WORKSPACE_SCHEMA);
db.exec(HTTP_SCHEMA);
db.exec('PRAGMA user_version = ' + SCHEMA_VERSION);

/** Salinan utuh database saat start — murah, dan menyelamatkan data kalau file rusak. */
const backupFile = file + '.bak';
if (existsSync(file)) {
  try {
    rmSync(backupFile, { force: true });
    db.exec("VACUUM INTO '" + backupFile.replace(/'/g, "''") + "'");
  } catch {
    // backup gagal (disk penuh / hak akses): jangan hentikan aplikasi
  }
}

export function all<T>(sql: string, ...params: Array<string | number | null>): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function one<T>(sql: string, ...params: Array<string | number | null>): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

/** Jalankan INSERT/UPDATE/DELETE, kembalikan jumlah baris yang berubah. */
export function run(sql: string, ...params: Array<string | number | null>): number {
  return Number(db.prepare(sql).run(...params).changes);
}

/** Catat path yang dibuka (nginx, file explorer) — isi file tetap di disk. */
export function touchPath(kind: string, path: string): void {
  run(
    'INSERT INTO recent_paths (kind, path, opened_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(kind, path) DO UPDATE SET opened_at = excluded.opened_at',
    kind,
    path,
    Date.now(),
  );
  run(
    'DELETE FROM recent_paths WHERE kind = ? AND path NOT IN ' +
      '(SELECT path FROM recent_paths WHERE kind = ? ORDER BY opened_at DESC LIMIT 50)',
    kind,
    kind,
  );
}

/**
 * Ganti database yang sedang dipakai dengan file hasil restore, lalu buka ulang.
 * Koneksi lama ditutup supaya tidak ada dua penulis; berkas -wal/-shm dibuang.
 */
function configureDb(target: DatabaseSync): void {
  target.exec('PRAGMA journal_mode = WAL');
  target.exec('PRAGMA foreign_keys = ON');
  target.exec('PRAGMA busy_timeout = 5000');
  target.exec('PRAGMA synchronous = NORMAL');
}

function ensureExtraSchema(target: DatabaseSync): void {
  target.exec(
    'CREATE TABLE IF NOT EXISTS audit_log (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT NOT NULL, actor TEXT NOT NULL, ' +
      'feature TEXT NOT NULL, action TEXT NOT NULL, method TEXT, path TEXT, status INTEGER, ' +
      'duration_ms INTEGER NOT NULL DEFAULT 0, ip TEXT, user_agent TEXT, payload TEXT, error TEXT)',
  );
  target.exec('CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC)');
  target.exec('CREATE INDEX IF NOT EXISTS idx_audit_source ON audit_log(source, ts DESC)');
  target.exec('CREATE INDEX IF NOT EXISTS idx_audit_feature ON audit_log(feature, ts DESC)');
  target.exec(
    'CREATE TABLE IF NOT EXISTS compare_history (' +
      'id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, left_text TEXT NOT NULL, ' +
      'right_text TEXT NOT NULL, left_lines INTEGER NOT NULL DEFAULT 0, right_lines INTEGER NOT NULL DEFAULT 0)',
  );
  target.exec('CREATE INDEX IF NOT EXISTS idx_compare_created ON compare_history(id DESC)');
  target.exec(
    'CREATE TABLE IF NOT EXISTS jobs (' +
      'id TEXT PRIMARY KEY, type TEXT NOT NULL, label TEXT NOT NULL, status TEXT NOT NULL, ' +
      'progress INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, started_at INTEGER, ' +
      "completed_at INTEGER, error TEXT, result TEXT, payload TEXT NOT NULL DEFAULT '{}', " +
      'cancellable INTEGER NOT NULL DEFAULT 0, dedupe_key TEXT)',
  );
  target.exec('CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC)');
  target.exec('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at)');
  target.exec('CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key, status)');
  target.exec(WORKSPACE_SCHEMA);
  target.exec(HTTP_SCHEMA);
  target.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
}

/**
 * Validasi file database sebelum menyentuh database aktif. Hanya baca, jadi
 * file backup tidak berubah. Dipakai juga oleh BackupService saat validasi zip.
 */
export function validateDatabaseFile(path: string): void {
  let check: DatabaseSync | null = null;
  try {
    check = new DatabaseSync(path, { readOnly: true });
    const integrity = check.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
    const bad = integrity.filter((row) => String(Object.values(row)[0] ?? '').toLowerCase() !== 'ok');
    if (!integrity.length || bad.length) throw new Error('Integritas database backup rusak');
    if ((check.prepare('PRAGMA foreign_key_check').all() as unknown[]).length) {
      throw new Error('Database backup melanggar foreign key');
    }
    const versionRow = check.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    const version = Number(versionRow?.user_version ?? 0);
    if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) {
      throw new Error('Versi skema backup tidak didukung (ditemukan ' + version + ', maks ' + SCHEMA_VERSION + ')');
    }
    const tables = new Set(
      (check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
        (row) => row.name,
      ),
    );
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      if (!tables.has(table)) throw new Error('Database backup tidak memuat tabel ' + table);
      const present = new Set(
        (check.prepare('PRAGMA table_info("' + table + '")').all() as Array<{ name: string }>).map((row) => row.name),
      );
      for (const column of columns) {
        if (!present.has(column)) throw new Error('Database backup tidak memuat kolom ' + table + '.' + column);
      }
    }
    const account = check.prepare('SELECT COUNT(*) AS n FROM account').get() as { n?: number } | undefined;
    if (Number(account?.n ?? 0) < 1) throw new Error('Database backup tidak memuat akun');
  } finally {
    check?.close();
  }
}

function checkpointLive(): void {
  const row = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: number } | undefined;
  if (Number(row?.busy ?? 0) !== 0) throw new Error('checkpoint busy');
}

function fsyncPath(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export type RestorePhase =
  | 'replacing'
  | 'uploads-moved'
  | 'uploads-installed'
  | 'old-moved'
  | 'installed'
  | 'prepared'
  | 'committed';

/** Titik rollback setelah langkah tertentu selesai; hanya untuk injeksi test. */
export type RollbackStep =
  | 'new-db-removed'
  | 'new-wal-removed'
  | 'new-uploads-removed'
  | 'old-uploads-restored'
  | 'old-db-restored'
  | 'old-db-opened'
  | 'journal-removed'
  | 'dir-synced';

/**
 * Titik injeksi untuk test fault. Produksi memakai default di bawah.
 * `onPhase` dipanggil setelah journal durable pada tahap tersebut.
 */
export type RestoreDeps = Partial<{
  copyFile: (source: string, target: string) => void;
  fsyncFile: (path: string) => void;
  rename: (from: string, to: string) => void;
  remove: (path: string) => void;
  removeDir: (path: string) => void;
  fsyncDir: (path: string) => void;
  checkpoint: () => void;
  checkpointPrepared: (target: DatabaseSync) => void;
  open: (path: string) => DatabaseSync;
  configure: (target: DatabaseSync) => void;
  migrate: (target: DatabaseSync) => void;
  revoke: (target: DatabaseSync) => void;
  validate: (path: string) => void;
  validatePrepared: (target: DatabaseSync) => void;
  onPhase: (phase: RestorePhase) => void;
  onRollback: (step: RollbackStep) => void;
}>;

/** `uploads` = folder uploads staging yang ikut ditukar; null = biarkan apa adanya. */
export type ReplaceOptions = RestoreDeps & { uploads?: string | null };

/**
 * Cabut sesi lama di dalam database staging: pv naik tepat satu dan nilainya
 * diverifikasi, jadi `revoked` hanya dilaporkan kalau perubahan benar-benar
 * terjadi pada database yang akan di-commit.
 */
function revokeSessions(target: DatabaseSync): void {
  const before = target.prepare('SELECT pv FROM account').get() as { pv?: number } | undefined;
  const pv = Number(before?.pv);
  if (!Number.isInteger(pv)) throw new Error('database restore tidak memuat akun');
  target.exec('UPDATE account SET pv = pv + 1');
  const after = target.prepare('SELECT pv FROM account').get() as { pv?: number } | undefined;
  if (Number(after?.pv) !== pv + 1) throw new Error('gagal mencabut sesi pada database restore');
}

/** Validasi keadaan akhir database staging: integritas + tepat satu akun. */
function validatePrepared(target: DatabaseSync): void {
  const integrity = target.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>;
  const bad = integrity.filter((row) => String(Object.values(row)[0] ?? '').toLowerCase() !== 'ok');
  if (!integrity.length || bad.length) throw new Error('integritas database hasil restore rusak');
  const account = target.prepare('SELECT COUNT(*) AS n FROM account').get() as { n?: number } | undefined;
  if (Number(account?.n ?? 0) !== 1) throw new Error('database hasil restore tidak memuat satu akun');
}

function checkpointPrepared(target: DatabaseSync): void {
  const row = target.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy?: number } | undefined;
  if (Number(row?.busy ?? 0) !== 0) throw new Error('checkpoint database baru busy');
}

let restoreInProgress = false;

/** Outcome transaksi tidak pasti: jangan rollback, jangan layani request. */
function abortUncertainRestore(message: string, cause: unknown): never {
  const detail = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write('restore: ' + message + ' (' + detail + ')\n');
  process.stderr.write('restore: journal dan artefak dipertahankan; proses dihentikan\n');
  process.exit(1);
}

/**
 * Ganti database (dan opsional folder uploads) sebagai satu transaksi:
 * 1. Salin + fsync + validasi incoming; database aktif belum disentuh.
 * 2. Checkpoint WAL lalu tutup koneksi aktif.
 * 3. Tulis journal `replacing` yang mencatat status uploads.
 * 4. Tukar uploads, lalu pindahkan DB lama ke `.restore-old` dan pasang DB baru
 *    lewat rename. Semua rename disusul fsync direktori.
 * 5. Buka DB baru, konfigurasi, lengkapi skema, cabut sesi (pv+1), checkpoint
 *    dan fsync supaya pencabutan ikut durable sebelum titik commit.
 * 6. Tulis journal `committed`; setelah itu kegagalan pembersihan hanya
 *    peringatan dan journal dipertahankan agar startup mengulang pembersihan.
 * Kegagalan sebelum commit mengembalikan database dan uploads lama.
 */
export function replaceDatabase(source: string, deps: ReplaceOptions = {}): { ok: true; path: string } {
  if (restoreInProgress) throw new Error('Restore database lain sedang berjalan');
  restoreInProgress = true;

  const installUploads = typeof deps.uploads === 'string';
  const stagedUploads = installUploads ? (deps.uploads as string) : null;
  const hadUploads = installUploads ? existsSync(uploadsDir) : false;

  const io = {
    copyFile: deps.copyFile ?? copyFileSync,
    fsyncFile: deps.fsyncFile ?? fsyncPath,
    rename: deps.rename ?? renameSync,
    remove: deps.remove ?? ((path: string) => rmSync(path, { force: true })),
    removeDir: deps.removeDir ?? ((path: string) => rmSync(path, { recursive: true, force: true })),
    fsyncDir: deps.fsyncDir ?? fsyncDir,
    checkpoint: deps.checkpoint ?? checkpointLive,
    checkpointPrepared: deps.checkpointPrepared ?? checkpointPrepared,
    open: deps.open ?? ((path: string) => new DatabaseSync(path)),
    configure: deps.configure ?? configureDb,
    migrate: deps.migrate ?? ensureExtraSchema,
    revoke: deps.revoke ?? revokeSessions,
    validate: deps.validate ?? validateDatabaseFile,
    validatePrepared: deps.validatePrepared ?? validatePrepared,
    onPhase: deps.onPhase ?? (() => {}),
    onRollback: deps.onRollback ?? (() => {}),
  };

  let closedLive = false;
  let uploadsMoved = false;
  let uploadsInstalled = false;
  let oldMoved = false;
  let installed = false;
  let committed = false;
  let next: DatabaseSync | null = null;

  try {
    io.remove(restoreIncoming);
    try {
      io.copyFile(source, restoreIncoming);
    } catch {
      throw new Error('Gagal menyalin database restore');
    }
    try {
      io.fsyncFile(restoreIncoming);
    } catch {
      throw new Error('Gagal fsync database restore');
    }
    try {
      io.validate(restoreIncoming);
    } catch (err) {
      throw new Error('Database restore tidak valid: ' + (err as Error).message);
    }

    // Checkpoint wajib berhasil: memindahkan file utama tanpa WAL yang bersih
    // akan membuang data yang belum masuk ke file .db.
    try {
      io.checkpoint();
    } catch {
      throw new Error('Checkpoint database gagal; restore dibatalkan');
    }

    db.close();
    closedLive = true;

    // Artefak sisa transaksi sebelumnya tidak boleh dianggap bagian transaksi ini.
    io.remove(restoreOld);
    if (installUploads) io.removeDir(uploadsOld);
    writeRestoreJournal({ phase: 'replacing', uploads: installUploads, hadUploads }, io.fsyncDir);
    io.onPhase('replacing');

    if (installUploads && stagedUploads) {
      try {
        if (hadUploads) {
          io.rename(uploadsDir, uploadsOld);
          uploadsMoved = true;
        }
        io.fsyncDir(cfg.dataDir);
      } catch {
        throw new Error('Gagal memindahkan folder uploads lama');
      }
      io.onPhase('uploads-moved');
      try {
        io.rename(stagedUploads, uploadsDir);
        uploadsInstalled = true;
        io.fsyncDir(cfg.dataDir);
      } catch {
        throw new Error('Gagal memasang folder uploads baru');
      }
      io.onPhase('uploads-installed');
    }

    if (existsSync(file)) {
      try {
        io.rename(file, restoreOld);
      } catch {
        throw new Error('Gagal memindahkan database lama');
      }
      oldMoved = true;
    }
    try {
      io.remove(file + '-wal');
      io.remove(file + '-shm');
    } catch {
      throw new Error('Gagal membersihkan WAL database lama');
    }
    try {
      io.fsyncDir(cfg.dataDir);
    } catch {
      throw new Error('Gagal menyinkronkan pemindahan database lama');
    }
    io.onPhase('old-moved');

    try {
      io.rename(restoreIncoming, file);
    } catch {
      throw new Error('Gagal memasang database baru');
    }
    installed = true;
    try {
      io.fsyncDir(cfg.dataDir);
    } catch {
      throw new Error('Gagal menyinkronkan instalasi database baru');
    }
    io.onPhase('installed');

    try {
      next = io.open(file);
    } catch {
      throw new Error('Gagal membuka database baru');
    }
    try {
      io.configure(next);
    } catch {
      throw new Error('Gagal mengonfigurasi database baru');
    }
    try {
      io.migrate(next);
    } catch {
      throw new Error('Gagal menyiapkan skema database baru');
    }
    // Pencabutan sesi terjadi di database staging, bukan setelah commit: kalau
    // restore commit, pencabutan pasti ikut commit; kalau gagal, DB lama utuh.
    try {
      io.revoke(next);
    } catch (err) {
      throw new Error('Gagal mencabut sesi database restore: ' + (err as Error).message);
    }
    try {
      io.checkpointPrepared(next);
    } catch {
      throw new Error('Checkpoint database baru gagal');
    }
    try {
      io.validatePrepared(next);
    } catch (err) {
      throw new Error('Database restore tidak valid: ' + (err as Error).message);
    }
    try {
      io.fsyncFile(file);
      io.fsyncDir(cfg.dataDir);
    } catch {
      throw new Error('Gagal menyinkronkan database baru ke disk');
    }
    io.onPhase('prepared');

    // Commit boundary eksplisit: rename journal adalah satu-satunya source of
    // truth. `committed` diset tepat setelah rename, sebelum durability
    // direktori dikonfirmasi, sehingga kegagalan fsync berikutnya tidak pernah
    // memicu rollback yang menghapus generasi yang sudah tercatat commit.
    installRestoreJournal({ phase: 'committed', uploads: installUploads, hadUploads });
    committed = true;
    try {
      io.fsyncDir(cfg.dataDir);
    } catch (err) {
      abortUncertainRestore('journal commit terpasang tetapi fsync direktori gagal; rollback dibatalkan', err);
    }
    io.onPhase('committed');
    db = next;
    next = null;

    // Pasca-commit: kegagalan pembersihan tidak membatalkan restore, tetapi
    // journal dipertahankan supaya startup mengulang pembersihan.
    let cleanupOk = true;
    try {
      io.remove(restoreOld);
    } catch {
      cleanupOk = false;
      process.stderr.write('restore: database aktif, gagal menghapus salinan database lama\n');
    }
    try {
      io.remove(restoreIncoming);
    } catch {
      cleanupOk = false;
      process.stderr.write('restore: database aktif, gagal menghapus file staging\n');
    }
    if (installUploads) {
      try {
        io.removeDir(uploadsOld);
      } catch {
        cleanupOk = false;
        process.stderr.write('restore: database aktif, gagal menghapus salinan uploads lama\n');
      }
    }
    try {
      io.fsyncDir(cfg.dataDir);
    } catch {
      cleanupOk = false;
      process.stderr.write('restore: database aktif, fsync direktori gagal\n');
    }
    if (cleanupOk) {
      try {
        removeRestoreJournal();
      } catch {
        process.stderr.write('restore: database aktif, journal gagal dihapus\n');
      }
    } else {
      process.stderr.write('restore: database aktif, artefak sisa dibersihkan saat startup\n');
    }

    notifyDatabaseReplaced();
    return { ok: true, path: file };
  } catch (err) {
    if (committed) {
      // Journal sudah tercatat commit: rollback dilarang karena bisa menghapus
      // generasi yang otoritatif. Fail closed, startup menyelesaikan cleanup.
      abortUncertainRestore('restore gagal setelah journal commit terpasang', err);
    }
    if (next) {
      try {
        next.close();
      } catch {
        // handle baru mungkin sudah tidak bisa ditutup; file tetap dihapus
      }
    }
    if (closedLive) {
      try {
        if (installed) {
          io.remove(file);
          io.onRollback('new-db-removed');
          io.remove(file + '-wal');
          io.remove(file + '-shm');
          io.onRollback('new-wal-removed');
        }
        if (uploadsInstalled) {
          io.removeDir(uploadsDir);
          io.onRollback('new-uploads-removed');
        }
        if (uploadsMoved && existsSync(uploadsOld)) {
          io.rename(uploadsOld, uploadsDir);
          io.onRollback('old-uploads-restored');
        }
        if (oldMoved && existsSync(restoreOld)) {
          io.rename(restoreOld, file);
          io.onRollback('old-db-restored');
        }
        if (existsSync(file)) {
          db = new DatabaseSync(file);
          configureDb(db);
          io.onRollback('old-db-opened');
        }
        io.remove(restoreIncoming);
        removeRestoreJournal();
        io.onRollback('journal-removed');
        io.fsyncDir(cfg.dataDir);
        io.onRollback('dir-synced');
      } catch (rollbackErr) {
        // Rollback gagal: hasil transaksi tidak pasti (bisa database baru,
        // bisa campuran DB/uploads). Melanjutkan request berisiko memakai
        // state yang salah, jadi proses dihentikan dengan journal dan artefak
        // utuh; startup berikutnya memulihkan secara idempoten.
        process.stderr.write('restore: error asli (' + (err as Error).message + ')\n');
        abortUncertainRestore('rollback gagal, state tidak pasti', rollbackErr);
      }
    } else {
      try {
        io.remove(restoreIncoming);
      } catch {
        // file staging bisa dibersihkan startup
      }
    }
    throw err;
  } finally {
    restoreInProgress = false;
  }
}

export function recentPaths(kind: string, limit = 8): Array<{ path: string; openedAt: number }> {
  return all<{ path: string; openedAt: number }>(
    'SELECT path, opened_at AS openedAt FROM recent_paths WHERE kind = ? ORDER BY opened_at DESC LIMIT ?',
    kind,
    Math.min(Math.max(limit, 1), 50),
  );
}

/**
 * Impor sekali dari versi lama yang masih menyimpan JSON.
 * Dicek juga folder ./data di project, lokasi default versi pertama.
 */
function importLegacyJson(): void {
  const dirs = [cfg.dataDir, join(process.cwd(), 'data')];
  const hasAccount = one<{ n: number }>('SELECT COUNT(*) AS n FROM account')?.n ?? 0;
  const hasNotes = one<{ n: number }>('SELECT COUNT(*) AS n FROM notes')?.n ?? 0;

  for (const dir of dirs) {
    if (!hasAccount) importAccount(join(dir, 'auth.json'));
    if (!hasNotes) importNotes(join(dir, 'notes.json'));
  }
}

function importAccount(authFile: string): void {
  if (!existsSync(authFile)) return;
  if ((one<{ n: number }>('SELECT COUNT(*) AS n FROM account')?.n ?? 0) > 0) return;
  try {
    const saved = JSON.parse(readFileSync(authFile, 'utf8')) as {
      salt: string;
      hash: string;
      pv: number;
      mustChange: boolean;
      secret: string;
    };
    run(
      'INSERT INTO account (id, salt, hash, pv, must_change, secret, created_at) VALUES (1, ?, ?, ?, ?, ?, ?)',
      saved.salt,
      saved.hash,
      saved.pv,
      saved.mustChange ? 1 : 0,
      saved.secret,
      Date.now(),
    );
    renameSync(authFile, authFile + '.imported');
  } catch {
    // file rusak: biarkan, nanti akun dibuat ulang dengan password default
  }
}

function importNotes(notesFile: string): void {
  if (!existsSync(notesFile)) return;
  if ((one<{ n: number }>('SELECT COUNT(*) AS n FROM notes')?.n ?? 0) > 0) return;
  try {
    const saved = JSON.parse(readFileSync(notesFile, 'utf8')) as Array<{
      id: string;
      title: string;
      body: string;
      createdAt: number;
      updatedAt: number;
    }>;
    for (const note of saved) {
      run(
        'INSERT OR IGNORE INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        note.id,
        note.title ?? '',
        note.body ?? '',
        note.createdAt ?? Date.now(),
        note.updatedAt ?? Date.now(),
      );
    }
    renameSync(notesFile, notesFile + '.imported');
  } catch {
    // file rusak: lewati
  }
}

importLegacyJson();
