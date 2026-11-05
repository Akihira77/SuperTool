import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { cfg } from '../../config';

/** Batas baris yang dikirim ke browser supaya tabel besar tidak membekukan UI. */
const MAX_ROWS = 500;
/** Hanya perintah baca yang boleh lewat. */
const READ_ONLY = /^(select|with|pragma|explain)\b/i;

type Row = Record<string, unknown>;

function quote(name: string): string {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

/**
 * Penampil database aplikasi (super-tool.db). Selalu dibuka read-only:
 * viewer tidak boleh merusak data yang sedang dipakai proses utama.
 * ponytail: satu koneksi per request, ditutup lagi — DB kecil, tidak perlu pool.
 */
@Injectable()
export class SqliteService {
  private file(): string {
    return join(cfg.dataDir, 'super-tool.db');
  }

  private open(): DatabaseSync {
    // readOnly: viewer tidak pernah menulis. WAL sudah permanen di file database
    // (diset oleh koneksi utama), busy_timeout mencegah "database is locked"
    // ketika proses utama sedang menulis saat viewer membaca.
    const db = new DatabaseSync(this.file(), { readOnly: true });
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA query_only = ON');
    } catch {
      // pragma opsional
    }
    return db;
  }

  async info() {
    const info = await stat(this.file()).catch(() => null);
    const db = this.open();
    try {
      const objects = db
        .prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string; type: string }>;
      const tables = objects.map((item) => {
        let rows = 0;
        try {
          rows = Number((db.prepare('SELECT COUNT(*) AS n FROM ' + quote(item.name)).get() as { n: number }).n);
        } catch {
          rows = -1;
        }
        return { name: item.name, type: item.type, rows };
      });
      return { path: this.file(), size: info?.size ?? 0, mtime: info?.mtimeMs ?? 0, tables };
    } finally {
      db.close();
    }
  }

  async table(name: string, limit = 100, offset = 0) {
    const db = this.open();
    try {
      const exists = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
        .get(String(name));
      if (!exists) throw new NotFoundException('Tabel tidak ditemukan');
      const total = Number((db.prepare('SELECT COUNT(*) AS n FROM ' + quote(name)).get() as { n: number }).n);
      const size = Math.min(MAX_ROWS, Math.max(1, Number(limit) || 100));
      const start = Math.max(0, Number(offset) || 0);
      const columns = (db.prepare('PRAGMA table_info(' + quote(name) + ')').all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
      const rows = db
        .prepare('SELECT * FROM ' + quote(name) + ' LIMIT ' + size + ' OFFSET ' + start)
        .all() as Row[];
      return { table: name, columns, rows, total, limit: size, offset: start };
    } finally {
      db.close();
    }
  }

  async query(sql: string) {
    const text = String(sql ?? '').trim();
    if (!text) throw new BadRequestException('SQL kosong');
    if (!READ_ONLY.test(text)) {
      throw new BadRequestException('Hanya SELECT / WITH / PRAGMA / EXPLAIN yang diizinkan');
    }
    if (text.replace(/;\s*$/, '').includes(';')) {
      throw new BadRequestException('Satu perintah per query');
    }
    const db = this.open();
    try {
      const rows = db.prepare(text).all() as Row[];
      const columns = rows.length ? Object.keys(rows[0]) : [];
      return { columns, rows: rows.slice(0, MAX_ROWS), total: rows.length, truncated: rows.length > MAX_ROWS };
    } catch (err) {
      throw new BadRequestException('SQL gagal: ' + (err as Error).message.slice(0, 160));
    } finally {
      db.close();
    }
  }
}
