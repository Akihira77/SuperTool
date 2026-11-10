import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { db } from '../../common/db';

type Header = { key?: string; value?: string };
export type SavedRequest = {
  id: string;
  name: string;
  collectionId: string | null;
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
  updatedAt: number;
};

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const SENSITIVE = new Set(['authorization', 'cookie', 'proxy-authorization', 'x-api-key', 'api-key', 'x-auth-token']);
const MAX_BODY = 1024 * 1024;
const MAX_VARS = 50;

function text(value: unknown, max: number, label: string): string {
  const out = String(value ?? '').trim();
  if (out.length > max) throw new BadRequestException(label + ' terlalu panjang');
  return out;
}

/** Header sensitif tidak pernah disimpan; nilainya dikosongkan, bukan diredaksi separuh. */
function sanitizeHeaders(raw: unknown): string {
  if (!Array.isArray(raw)) return '[]';
  const rows: Array<{ key: string; value: string }> = [];
  for (const item of raw.slice(0, 100)) {
    const row = item as Header;
    const key = String(row?.key ?? '').trim().slice(0, 100);
    if (!key) continue;
    const value = SENSITIVE.has(key.toLowerCase()) ? '' : String(row?.value ?? '').slice(0, 4000);
    rows.push({ key, value });
  }
  return JSON.stringify(rows);
}

function parseHeaders(raw: unknown): Array<{ key: string; value: string }> {
  try {
    const rows = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

@Injectable()
export class HttpStoreService {
  list(query = ''): SavedRequest[] {
    const term = '%' + String(query).trim().slice(0, 100) + '%';
    const rows = db
      .prepare(
        'SELECT id, name, collection_id, method, url, headers, body, updated_at FROM http_requests ' +
          'WHERE name LIKE ? OR url LIKE ? ORDER BY updated_at DESC LIMIT 200',
      )
      .all(term, term) as Array<Record<string, unknown>>;
    return rows.map((row) => this.view(row));
  }

  save(input: Record<string, unknown>): SavedRequest {
    const method = text(input.method ?? 'GET', 10, 'Method').toUpperCase();
    if (!METHODS.has(method)) throw new BadRequestException('Method tidak didukung');
    const url = text(input.url, 4000, 'URL');
    if (!url) throw new BadRequestException('URL wajib diisi');
    const body = String(input.body ?? '');
    if (body.length > MAX_BODY) throw new BadRequestException('Body terlalu besar');
    const name = text(input.name, 160, 'Nama') || method + ' ' + url.slice(0, 120);
    const collectionId = input.collectionId ? text(input.collectionId, 64, 'Koleksi') || null : null;
    if (collectionId) {
      const found = db.prepare('SELECT id FROM http_collections WHERE id = ?').get(collectionId);
      if (!found) throw new BadRequestException('Koleksi tidak ditemukan');
    }
    const headers = sanitizeHeaders(input.headers);
    const now = Date.now();
    const id = input.id ? text(input.id, 64, 'ID') : randomUUID();
    const existing = input.id ? db.prepare('SELECT id, created_at FROM http_requests WHERE id = ?').get(id) : null;
    if (existing) {
      db.prepare(
        'UPDATE http_requests SET collection_id = ?, name = ?, method = ?, url = ?, headers = ?, body = ?, updated_at = ? WHERE id = ?',
      ).run(collectionId, name, method, url, headers, body, now, id);
    } else {
      db.prepare(
        'INSERT INTO http_requests (id, collection_id, name, method, url, headers, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(id, collectionId, name, method, url, headers, body, now, now);
    }
    return this.get(id);
  }

  get(id: string): SavedRequest {
    const row = db.prepare('SELECT * FROM http_requests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) throw new NotFoundException('Request tidak ditemukan');
    return this.view(row);
  }

  remove(id: string): { ok: true } {
    const result = db.prepare('DELETE FROM http_requests WHERE id = ?').run(id);
    if (!result.changes) throw new NotFoundException('Request tidak ditemukan');
    return { ok: true };
  }

  collections(): Array<{ id: string; name: string; count: number }> {
    return db
      .prepare(
        'SELECT c.id, c.name, COUNT(r.id) AS count FROM http_collections c ' +
          'LEFT JOIN http_requests r ON r.collection_id = c.id GROUP BY c.id ORDER BY c.name COLLATE NOCASE',
      )
      .all() as Array<{ id: string; name: string; count: number }>;
  }

  saveCollection(input: Record<string, unknown>): { id: string; name: string; count: number } {
    const name = text(input.name, 80, 'Nama koleksi');
    if (!name) throw new BadRequestException('Nama koleksi wajib diisi');
    const now = Date.now();
    const id = input.id ? text(input.id, 64, 'ID') : randomUUID();
    db.prepare(
      'INSERT INTO http_collections (id, name, created_at, updated_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at',
    ).run(id, name, now, now);
    const found = this.collections().find((item) => item.id === id);
    return found ?? { id, name, count: 0 };
  }

  removeCollection(id: string): { ok: true } {
    db.prepare('UPDATE http_requests SET collection_id = NULL WHERE collection_id = ?').run(id);
    const result = db.prepare('DELETE FROM http_collections WHERE id = ?').run(id);
    if (!result.changes) throw new NotFoundException('Koleksi tidak ditemukan');
    return { ok: true };
  }

  environments(): Array<{ id: string; name: string; variables: Array<{ key: string; value: string }> }> {
    const rows = db.prepare('SELECT id, name, variables FROM http_environments ORDER BY name COLLATE NOCASE').all() as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      variables: this.parseVariables(row.variables),
    }));
  }

  saveEnvironment(input: Record<string, unknown>): { id: string; name: string; variables: Array<{ key: string; value: string }> } {
    const name = text(input.name, 80, 'Nama environment');
    if (!name) throw new BadRequestException('Nama environment wajib diisi');
    const variables = this.sanitizeVariables(input.variables);
    const now = Date.now();
    const id = input.id ? text(input.id, 64, 'ID') : randomUUID();
    db.prepare(
      'INSERT INTO http_environments (id, name, variables, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET name = excluded.name, variables = excluded.variables, updated_at = excluded.updated_at',
    ).run(id, name, variables, now, now);
    return { id, name, variables: this.parseVariables(variables) };
  }

  removeEnvironment(id: string): { ok: true } {
    const result = db.prepare('DELETE FROM http_environments WHERE id = ?').run(id);
    if (!result.changes) throw new NotFoundException('Environment tidak ditemukan');
    return { ok: true };
  }

  history(limit = 30): Array<Record<string, unknown>> {
    const size = Math.min(Math.max(Number(limit) || 30, 1), 100);
    return db
      .prepare('SELECT id, ts, method, url, status, duration_ms AS durationMs, size, error FROM http_history ORDER BY id DESC LIMIT ?')
      .all(size) as Array<Record<string, unknown>>;
  }

  record(entry: { method: string; url: string; status?: number; durationMs?: number; size?: number; error?: string }): void {
    db.prepare('INSERT INTO http_history (ts, method, url, status, duration_ms, size, error) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      Date.now(),
      entry.method.slice(0, 10),
      entry.url.slice(0, 2000),
      entry.status ?? null,
      Math.max(0, Math.round(entry.durationMs ?? 0)),
      Math.max(0, Math.round(entry.size ?? 0)),
      entry.error ? entry.error.slice(0, 500) : null,
    );
    db.prepare('DELETE FROM http_history WHERE id NOT IN (SELECT id FROM http_history ORDER BY id DESC LIMIT 200)').run();
  }

  clearHistory(): { ok: true } {
    db.prepare('DELETE FROM http_history').run();
    return { ok: true };
  }

  private view(row: Record<string, unknown>): SavedRequest {
    return {
      id: String(row.id),
      name: String(row.name),
      collectionId: row.collection_id ? String(row.collection_id) : null,
      method: String(row.method),
      url: String(row.url),
      headers: parseHeaders(row.headers),
      body: String(row.body ?? ''),
      updatedAt: Number(row.updated_at ?? 0),
    };
  }

  private sanitizeVariables(raw: unknown): string {
    if (!Array.isArray(raw)) return '[]';
    const rows: Array<{ key: string; value: string }> = [];
    for (const item of raw.slice(0, MAX_VARS)) {
      const row = item as Header;
      const key = String(row?.key ?? '').trim();
      const value = String(row?.value ?? '').trim();
      if (!key && !value) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) throw new BadRequestException('Nama variabel tidak valid: ' + key.slice(0, 40));
      rows.push({ key, value: value.slice(0, 2000) });
    }
    return JSON.stringify(rows);
  }

  private parseVariables(raw: unknown): Array<{ key: string; value: string }> {
    try {
      const rows = JSON.parse(String(raw ?? '[]'));
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }
}
