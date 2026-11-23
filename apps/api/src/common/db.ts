import { DatabaseSync } from 'node:sqlite';
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

type RestoreJournal = { phase: 'replacing' | 'committed' };

function removeQuiet(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // pembersihan bersifat best-effort; jangan menutupi error utama
  }
}

function readRestoreJournal(): RestoreJournal | null {
  if (!existsSync(restoreJournal)) return null;
  try {
    const parsed = JSON.parse(readFileSync(restoreJournal, 'utf8')) as { phase?: string };
    return { phase: parsed.phase === 'committed' ? 'committed' : 'replacing' };
  } catch {
    // Journal rusak: perlakukan sebagai penggantian yang belum commit.
    return { phase: 'replacing' };
  }
}

function fsyncDir(path: string): void {
  try {
    const fd = openSync(path, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // fsync direktori tidak didukung di semua filesystem; rename tetap atomik.
  }
}

function writeRestoreJournal(phase: RestoreJournal['phase']): void {
  const tmp = restoreJournal + '.tmp';
  writeFileSync(tmp, JSON.stringify({ phase, at: Date.now() }), { encoding: 'utf8', mode: 0o600 });
  const fd = openSync(tmp, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, restoreJournal);
  fsyncDir(cfg.dataDir);
}

function removeRestoreJournal(): void {
  rmSync(restoreJournal, { force: true });
  removeQuiet(restoreJournal + '.tmp');
  fsyncDir(cfg.dataDir);
}

/**
 * Pulihkan sisa penggantian database yang terputus (crash/SIGKILL).
 * Journal menentukan apakah penggantian sudah commit:
 * - committed: file aktif adalah database baru; artefak lama dibuang.
 * - replacing: salinan lama dipulihkan bila ada; kalau tidak, file aktif
 *   dipertahankan karena incoming sudah divalidasi sebelum journal ditulis.
 */
export function recoverInterruptedRestore(): void {
  const journal = readRestoreJournal();

  if (!journal) {
    // Kompatibilitas dengan proses versi lama yang belum memakai journal.
    if (!existsSync(file) && existsSync(restoreOld)) renameSync(restoreOld, file);
    // Journal dihapus paling akhir; tanpa journal, salinan lama hanya sisa
    // pembersihan pasca-commit dan aman dibuang selama file aktif ada.
    else if (existsSync(file)) removeQuiet(restoreOld);
    removeQuiet(restoreIncoming);
    return;
  }

  if (journal.phase === 'committed') {
    removeQuiet(restoreOld);
    removeQuiet(restoreIncoming);
    removeRestoreJournal();
    return;
  }

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
  removeRestoreJournal();
}

recoverInterruptedRestore();

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

/** Kolom minimum yang dipakai modul aplikasi; DB lama tanpa kolom ini ditolak. */
const REQUIRED_COLUMNS: Record<string, string[]> = {
  account: ['id', 'salt', 'hash', 'pv', 'must_change', 'secret', 'created_at'],
  notes: ['id', 'title', 'body', 'created_at', 'updated_at'],
  urls: ['id', 'name', 'url', 'proxy', 'created_at'],
};

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

export type RestorePhase = 'replacing' | 'old-moved' | 'installed' | 'committed';

/**
 * Titik injeksi untuk test fault. Produksi memakai default di bawah.
 * `onPhase` dipanggil setelah journal durable pada tahap tersebut.
 */
export type RestoreDeps = Partial<{
  copyFile: (source: string, target: string) => void;
  fsyncFile: (path: string) => void;
  rename: (from: string, to: string) => void;
  remove: (path: string) => void;
  checkpoint: () => void;
  open: (path: string) => DatabaseSync;
  configure: (target: DatabaseSync) => void;
  migrate: (target: DatabaseSync) => void;
  validate: (path: string) => void;
  onPhase: (phase: RestorePhase) => void;
}>;

let restoreInProgress = false;

/**
 * Ganti database secara atomik dengan urutan:
 * 1. Salin + fsync + validasi incoming; database aktif belum disentuh.
 * 2. Checkpoint WAL lalu tutup koneksi aktif.
 * 3. Tulis journal `replacing`, pindahkan DB lama ke `.restore-old`, pasang
 *    DB baru lewat rename.
 * 4. Buka, konfigurasi, dan lengkapi skema DB baru.
 * 5. Tulis journal `committed` sebagai titik commit, baru bersihkan artefak.
 * Kegagalan sebelum commit mengembalikan DB lama; kegagalan setelah commit
 * hanya menjadi peringatan pembersihan dan tidak membatalkan restore.
 */
export function replaceDatabase(source: string, deps: RestoreDeps = {}): { ok: true; path: string } {
  if (restoreInProgress) throw new Error('Restore database lain sedang berjalan');
  restoreInProgress = true;

  const io = {
    copyFile: deps.copyFile ?? copyFileSync,
    fsyncFile: deps.fsyncFile ?? fsyncPath,
    rename: deps.rename ?? renameSync,
    remove: deps.remove ?? ((path: string) => rmSync(path, { force: true })),
    checkpoint: deps.checkpoint ?? checkpointLive,
    open: deps.open ?? ((path: string) => new DatabaseSync(path)),
    configure: deps.configure ?? configureDb,
    migrate: deps.migrate ?? ensureExtraSchema,
    validate: deps.validate ?? validateDatabaseFile,
    onPhase: deps.onPhase ?? (() => {}),
  };

  let closedLive = false;
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

    io.remove(restoreOld);
    writeRestoreJournal('replacing');
    io.onPhase('replacing');

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
    io.onPhase('old-moved');

    try {
      io.rename(restoreIncoming, file);
    } catch {
      throw new Error('Gagal memasang database baru');
    }
    installed = true;
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

    writeRestoreJournal('committed');
    committed = true;
    io.onPhase('committed');
    db = next;
    next = null;

    // Setelah commit, kegagalan pembersihan tidak boleh membatalkan restore.
    try {
      io.remove(restoreOld);
    } catch {
      process.stderr.write('restore: database aktif, gagal menghapus salinan lama\n');
    }
    try {
      io.remove(restoreIncoming);
    } catch {
      process.stderr.write('restore: database aktif, gagal menghapus file staging\n');
    }
    try {
      removeRestoreJournal();
    } catch {
      process.stderr.write('restore: database aktif, journal gagal dihapus\n');
    }

    notifyDatabaseReplaced();
    return { ok: true, path: file };
  } catch (err) {
    if (!committed) {
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
            io.remove(file + '-wal');
            io.remove(file + '-shm');
          }
          if (oldMoved && existsSync(restoreOld)) io.rename(restoreOld, file);
          if (existsSync(file)) {
            db = new DatabaseSync(file);
            configureDb(db);
          }
          io.remove(restoreIncoming);
          removeRestoreJournal();
        } catch {
          // Journal dibiarkan; startup berikutnya akan memulihkan secara idempoten.
          try {
            if (existsSync(file)) {
              db = new DatabaseSync(file);
              configureDb(db);
            }
          } catch {
            // tidak ada lagi yang aman dilakukan; error asli tetap dilempar
          }
        }
      } else {
        try {
          io.remove(restoreIncoming);
        } catch {
          // file staging bisa dibersihkan startup
        }
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
