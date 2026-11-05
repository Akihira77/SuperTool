import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from '../config';

/**
 * Semua data aplikasi (akun, catatan, daftar URL, path yang pernah dibuka)
 * disimpan di satu database SQLite. Isi file (nginx, file explorer) tetap di
 * disk — database hanya mencatat path-nya.
 * ponytail: node:sqlite bawaan Node, tanpa dependensi tambahan.
 */
const file = join(cfg.dataDir, 'super-tool.db');
mkdirSync(cfg.dataDir, { recursive: true });

export const db = new DatabaseSync(file);

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
`);

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
