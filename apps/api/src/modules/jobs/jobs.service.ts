import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { all, one, run } from '../../common/db';

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type JobView = {
  id: string;
  type: string;
  label: string;
  status: JobStatus;
  progress: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  result: unknown;
  cancellable: boolean;
};

export type JobContext = {
  signal: AbortSignal;
  progress: (value: number) => void;
};

export type JobHandler = {
  run: (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;
  /** true hanya bila handler benar-benar berhenti saat signal dibatalkan. */
  cancellable?: boolean;
};

type Row = {
  id: string;
  type: string;
  label: string;
  status: JobStatus;
  progress: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  result: string | null;
  payload: string;
  cancellable: number;
};

const MAX_RESULT = 64 * 1024;
const MAX_ERROR = 2000;
const KEEP_JOBS = 200;
const KEEP_MS = 7 * 24 * 60 * 60_000;
const TERMINAL = "('completed','failed','cancelled')";

function configuredLimit(): number {
  const raw = Number(process.env.ST_JOB_CONCURRENCY);
  if (!Number.isFinite(raw) || raw < 1) return 2;
  return Math.min(8, Math.floor(raw));
}

function encode(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    return text.length > MAX_RESULT ? JSON.stringify({ truncated: true }) : text;
  } catch {
    return null;
  }
}

function decode(text: string | null): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return String((error as Error)?.message ?? error ?? 'Job gagal').slice(0, MAX_ERROR);
}

/**
 * Antrean job lokal: status tersimpan di SQLite, eksekusi di proses ini dengan
 * batas konkurensi. Riwayat bertahan setelah restart; job queued dilanjutkan,
 * job yang sedang berjalan saat proses mati ditandai gagal saat startup.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, JobHandler>();
  private readonly active = new Map<string, AbortController>();
  private readonly limit = configuredLimit();
  private running = 0;

  onModuleInit(): void {
    const interrupted = run("UPDATE jobs SET status='failed', completed_at=?, error='Terputus karena server restart' WHERE status='running'", Date.now());
    if (interrupted) this.logger.warn(interrupted + ' job ditandai gagal setelah restart');
    this.prune();
    this.kick();
  }

  onModuleDestroy(): void {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
  }

  register(type: string, handler: JobHandler): void {
    if (!type) throw new Error('Tipe job kosong');
    this.handlers.set(type, handler);
  }

  start(type: string, payload: Record<string, unknown> = {}, options: { label?: string; dedupeKey?: string } = {}): JobView {
    if (!this.handlers.has(type)) throw new BadRequestException('Tipe job tidak dikenal');
    if (options.dedupeKey) {
      const existing = one<Row>(
        "SELECT id, type, label, status, progress, created_at AS createdAt, started_at AS startedAt, " +
          "completed_at AS completedAt, error, result, payload, cancellable FROM jobs " +
          "WHERE dedupe_key = ? AND status IN ('queued','running') ORDER BY created_at LIMIT 1",
        options.dedupeKey,
      );
      if (existing) return this.view(existing);
    }
    const now = Date.now();
    const id = 'j' + now.toString(36) + '-' + randomUUID().slice(0, 8);
    const label = String(options.label ?? type).slice(0, 120);
    const cancellable = this.handlers.get(type)?.cancellable ? 1 : 0;
    run(
      'INSERT INTO jobs (id, type, label, status, progress, created_at, payload, cancellable, dedupe_key) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)',
      id,
      type,
      label,
      'queued',
      now,
      JSON.stringify(payload).slice(0, MAX_RESULT),
      cancellable,
      options.dedupeKey ?? null,
    );
    const row = this.row(id);
    this.kick();
    return this.view(row);
  }

  list(filter: { type?: string; status?: string; limit?: number } = {}): JobView[] {
    const where: string[] = [];
    const params: Array<string | number> = [];
    if (filter.type) {
      where.push('type = ?');
      params.push(filter.type);
    }
    const status = filter.status;
    if (status && ['queued', 'running', 'completed', 'failed', 'cancelled'].includes(status)) {
      where.push('status = ?');
      params.push(status);
    }
    const limit = Math.min(100, Math.max(1, Number(filter.limit) || 30));
    const sql =
      'SELECT id, type, label, status, progress, created_at AS createdAt, started_at AS startedAt, ' +
      'completed_at AS completedAt, error, result, payload, cancellable FROM jobs ' +
      (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
      'ORDER BY created_at DESC LIMIT ' +
      limit;
    return all<Row>(sql, ...params).map((row) => this.view(row));
  }

  get(id: string): JobView {
    return this.view(this.row(id));
  }

  cancel(id: string): JobView {
    const row = this.row(id);
    if (row.status === 'cancelled') return this.view(row);
    if (row.status === 'completed' || row.status === 'failed') {
      throw new BadRequestException('Job sudah selesai');
    }
    if (row.status === 'queued') {
      run("UPDATE jobs SET status='cancelled', completed_at=?, error='Dibatalkan sebelum dijalankan' WHERE id=?", Date.now(), id);
      return this.view(this.row(id));
    }
    if (!row.cancellable) throw new BadRequestException('Job ini tidak bisa dibatalkan saat berjalan');
    this.active.get(id)?.abort();
    return this.view(row);
  }

  private row(id: string): Row {
    const row = one<Row>(
      'SELECT id, type, label, status, progress, created_at AS createdAt, started_at AS startedAt, ' +
        'completed_at AS completedAt, error, result, payload, cancellable FROM jobs WHERE id = ?',
      String(id ?? ''),
    );
    if (!row) throw new NotFoundException('Job tidak ditemukan');
    return row;
  }

  private view(row: Row): JobView {
    return {
      id: row.id,
      type: row.type,
      label: row.label,
      status: row.status,
      progress: row.progress,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      error: row.error,
      result: decode(row.result),
      cancellable: Boolean(row.cancellable),
    };
  }

  private kick(): void {
    while (this.running < this.limit) {
      const row = one<Row>(
        "SELECT id, type, label, status, progress, created_at AS createdAt, started_at AS startedAt, " +
          "completed_at AS completedAt, error, result, payload, cancellable FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1",
      );
      if (!row) return;
      const handler = this.handlers.get(row.type);
      if (!handler) {
        run("UPDATE jobs SET status='failed', completed_at=?, error='Handler job tidak tersedia' WHERE id=?", Date.now(), row.id);
        continue;
      }
      run("UPDATE jobs SET status='running', started_at=?, progress=0 WHERE id=?", Date.now(), row.id);
      this.running += 1;
      void this.execute(row, handler);
    }
  }

  private async execute(row: Row, handler: JobHandler): Promise<void> {
    const controller = new AbortController();
    this.active.set(row.id, controller);
    const payload = (decode(row.payload) ?? {}) as Record<string, unknown>;
    const ctx: JobContext = {
      signal: controller.signal,
      progress: (value: number) => {
        const progress = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
        run('UPDATE jobs SET progress=? WHERE id=? AND status=?', progress, row.id, 'running');
      },
    };
    try {
      const result = await handler.run(payload, ctx);
      if (controller.signal.aborted) this.finish(row.id, 'cancelled', null, 'Dibatalkan');
      else this.finish(row.id, 'completed', result, null);
    } catch (error) {
      if (controller.signal.aborted) this.finish(row.id, 'cancelled', null, 'Dibatalkan');
      else this.finish(row.id, 'failed', null, messageOf(error));
    } finally {
      this.active.delete(row.id);
      this.running = Math.max(0, this.running - 1);
      this.prune();
      this.kick();
    }
  }

  private finish(id: string, status: JobStatus, result: unknown, error: string | null): void {
    if (status === 'completed') {
      run('UPDATE jobs SET status=?, progress=100, completed_at=?, result=? WHERE id=?', status, Date.now(), encode(result), id);
    } else {
      run('UPDATE jobs SET status=?, completed_at=?, error=? WHERE id=?', status, Date.now(), error, id);
    }
  }

  private prune(): void {
    try {
      run(
        'DELETE FROM jobs WHERE status IN ' + TERMINAL + ' AND (completed_at < ? OR id NOT IN (' +
          'SELECT id FROM jobs WHERE status IN ' + TERMINAL + ' ORDER BY created_at DESC LIMIT ' + KEEP_JOBS + '))',
        Date.now() - KEEP_MS,
      );
    } catch (error) {
      this.logger.warn('Gagal membersihkan riwayat job: ' + messageOf(error));
    }
  }
}
