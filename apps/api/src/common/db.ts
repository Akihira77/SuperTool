import { DatabaseSync } from 'node:sqlite';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync } from 'node:fs';
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


// Pulihkan DB lama bila proses sebelumnya berhenti di tengah replaceDatabase().
const restoreOld = file + '.restore-old';
if (!existsSync(file) && existsSync(restoreOld)) renameSync(restoreOld, file);
rmSync(file + '.restore-new', { force: true });

// Restore menukar folder uploads dengan rename; bila proses mati di antaranya,
// kembalikan salinan lama alih-alih membiarkan folder hilang.
const uploadsDir = join(cfg.dataDir, 'uploads');
const uploadsOld = uploadsDir + '.restore-old';
if (!existsSync(uploadsDir) && existsSync(uploadsOld)) renameSync(uploadsOld, uploadsDir);

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
  target.exec('PRAGMA user_version = ' + SCHEMA_VERSION);
}

/**
 * Ganti database secara atomik: salinan baru disiapkan di folder data, database
 * lama dipindahkan ke .restore-old, lalu file baru di-rename. Gagal di tahap mana
 * pun akan mengembalikan file lama.
 */
export function replaceDatabase(source: string): { ok: true; path: string } {
  const incoming = file + '.restore-new';
  const old = file + '.restore-old';
  rmSync(incoming, { force: true });

  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } catch {
    // checkpoint gagal bukan alasan membatalkan restore; file lama tetap utuh
  }
  db.close();

  let movedOld = false;
  try {
    copyFileSync(source, incoming);
    const fd = openSync(incoming, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    rmSync(old, { force: true });
    if (existsSync(file)) {
      renameSync(file, old);
      movedOld = true;
    }
    for (const suffix of ['-wal', '-shm']) rmSync(file + suffix, { force: true });
    renameSync(incoming, file);

    db = new DatabaseSync(file);
    configureDb(db);
    ensureExtraSchema(db);
    rmSync(old, { force: true });
    notifyDatabaseReplaced();
    return { ok: true, path: file };
  } catch (err) {
    try {
      for (const suffix of ['', '-wal', '-shm']) rmSync(file + suffix, { force: true });
      if (movedOld && existsSync(old)) renameSync(old, file);
      db = new DatabaseSync(file);
      configureDb(db);
    } catch {
      // rollback terbaik; error asli tetap dilempar
    }
    throw err;
  } finally {
    rmSync(incoming, { force: true });
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
