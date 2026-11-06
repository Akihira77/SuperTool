import { Injectable, Logger } from '@nestjs/common';
import { all, one, run } from '../../common/db';
import { serializeAuditPayload } from './audit.payload';

export type AuditSource = 'web' | 'telegram_bot';

export type AuditEntry = {
  source: AuditSource;
  actor: string;
  feature: string;
  action: string;
  method?: string | null;
  path?: string | null;
  status?: number | null;
  durationMs?: number;
  ip?: string | null;
  userAgent?: string | null;
  payload?: unknown;
  error?: string | null;
  ts?: number;
};

export type AuditItem = {
  id: number;
  ts: number;
  source: AuditSource;
  from: AuditSource;
  actor: string;
  feature: string;
  action: string;
  method: string | null;
  path: string | null;
  status: number | null;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  payload: unknown;
  error: string | null;
};

type AuditRow = Omit<AuditItem, 'payload' | 'from'> & { payload: string | null };

export type AuditQuery = {
  source?: string;
  actor?: string;
  feature?: string;
  q?: string;
  since?: number;
  until?: number;
  limit?: number;
  offset?: number;
};

function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function parsePayload(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  record(entry: AuditEntry): void {
    try {
      run(
        'INSERT INTO audit_log ' +
          '(ts, source, actor, feature, action, method, path, status, duration_ms, ip, user_agent, payload, error) ' +
          'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        Math.max(0, Number(entry.ts) || Date.now()),
        entry.source,
        clean(entry.actor, 200) || 'unknown',
        clean(entry.feature, 80) || 'unknown',
        clean(entry.action, 160) || 'unknown',
        entry.method ? clean(entry.method, 16) : null,
        entry.path ? clean(entry.path, 700) : null,
        entry.status === undefined || entry.status === null ? null : Math.trunc(entry.status),
        Math.max(0, Math.trunc(Number(entry.durationMs) || 0)),
        entry.ip ? clean(entry.ip, 80) : null,
        entry.userAgent ? clean(entry.userAgent, 300) : null,
        serializeAuditPayload(entry.payload),
        entry.error ? clean(entry.error, 1000) : null,
      );
    } catch (error) {
      // Audit tidak boleh menjatuhkan request utama.
      this.logger.warn('Gagal menulis audit log: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  list(query: AuditQuery = {}): { items: AuditItem[]; total: number; limit: number; offset: number } {
    const limit = Math.min(Math.max(Math.trunc(Number(query.limit) || 100), 1), 200);
    const offset = Math.max(Math.trunc(Number(query.offset) || 0), 0);
    const where: string[] = [];
    const params: Array<string | number> = [];

    const source = clean(query.source, 32);
    if (source === 'web' || source === 'telegram_bot') {
      where.push('source = ?');
      params.push(source);
    }
    const actor = clean(query.actor, 200);
    if (actor) {
      where.push('actor LIKE ?');
      params.push('%' + actor + '%');
    }
    const feature = clean(query.feature, 80);
    if (feature) {
      where.push('feature = ?');
      params.push(feature);
    }
    const q = clean(query.q, 200);
    if (q) {
      where.push('(actor LIKE ? OR feature LIKE ? OR action LIKE ? OR path LIKE ? OR payload LIKE ? OR error LIKE ?)');
      params.push('%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%', '%' + q + '%');
    }
    const since = Number(query.since);
    if (Number.isFinite(since) && since > 0) {
      where.push('ts >= ?');
      params.push(Math.trunc(since));
    }
    const until = Number(query.until);
    if (Number.isFinite(until) && until > 0) {
      where.push('ts <= ?');
      params.push(Math.trunc(until));
    }

    const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const total = one<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log' + whereSql, ...params)?.n ?? 0;
    const rows = all<AuditRow>(
      'SELECT id, ts, source, actor, feature, action, method, path, status, duration_ms AS durationMs, ' +
        'ip, user_agent AS userAgent, payload, error FROM audit_log' + whereSql +
        ' ORDER BY id DESC LIMIT ? OFFSET ?',
      ...params,
      limit,
      offset,
    );

    return {
      items: rows.map((row) => ({ ...row, from: row.source, payload: parsePayload(row.payload) })),
      total: Number(total) || 0,
      limit,
      offset,
    };
  }
}
