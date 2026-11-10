import { Injectable } from '@nestjs/common';
import { readFileSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../common/db';
import { cfg } from '../../config';
import { recentLogs, type LogEntry } from '../../common/log-buffer';

type Disk = { path: string; total: number; free: number; available: number } | null;

export type Diagnostics = {
  version: string;
  node: string;
  pid: number;
  uptimeSec: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  db: {
    path: string;
    size: number;
    walSize: number;
    pageCount: number;
    pageSize: number;
    freePages: number;
    userVersion: number;
    journalMode: string;
    ok: boolean;
    error: string | null;
  };
  disk: Disk;
  lastError: LogEntry | null;
  logs: LogEntry[];
};

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function integer(value: unknown): number {
  return Number(value ?? 0) || 0;
}

/** Ringkasan runtime untuk halaman Settings; semua pembacaan dibatasi dan tidak menulis. */
@Injectable()
export class DiagnosticsService {
  private versionCache: string | null = null;

  snapshot(limit = 40): Diagnostics {
    const memory = process.memoryUsage();
    let dbInfo: Diagnostics['db'];
    try {
      const pageCount = integer((db.prepare('PRAGMA page_count').get() as { page_count?: number } | undefined)?.page_count);
      const pageSize = integer((db.prepare('PRAGMA page_size').get() as { page_size?: number } | undefined)?.page_size);
      const freePages = integer((db.prepare('PRAGMA freelist_count').get() as { freelist_count?: number } | undefined)?.freelist_count);
      const userVersion = integer((db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined)?.user_version);
      const journalMode = String((db.prepare('PRAGMA journal_mode').get() as { journal_mode?: string } | undefined)?.journal_mode ?? 'unknown');
      db.prepare('SELECT 1').get();
      const path = join(cfg.dataDir, 'super-tool.db');
      dbInfo = {
        path,
        size: sizeOf(path),
        walSize: sizeOf(path + '-wal'),
        pageCount,
        pageSize,
        freePages,
        userVersion,
        journalMode,
        ok: true,
        error: null,
      };
    } catch (error) {
      dbInfo = {
        path: join(cfg.dataDir, 'super-tool.db'),
        size: 0,
        walSize: 0,
        pageCount: 0,
        pageSize: 0,
        freePages: 0,
        userVersion: 0,
        journalMode: 'unknown',
        ok: false,
        error: String((error as Error)?.message ?? error).slice(0, 300),
      };
    }

    let disk: Disk = null;
    try {
      const st = statfsSync(cfg.dataDir, { bigint: true });
      disk = {
        path: cfg.dataDir,
        total: Number(st.bsize * st.blocks),
        free: Number(st.bsize * st.bfree),
        available: Number(st.bsize * st.bavail),
      };
    } catch {
      disk = null;
    }

    const logs = recentLogs(limit);
    const lastError = [...logs].reverse().find((entry) => entry.level === 'error') ?? null;
    return {
      version: this.version(),
      node: process.version,
      pid: process.pid,
      uptimeSec: Math.round(process.uptime()),
      memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal },
      db: dbInfo,
      disk,
      lastError,
      logs,
    };
  }

  private version(): string {
    if (this.versionCache) return this.versionCache;
    try {
      const pkg = JSON.parse(readFileSync(join(__dirname, '../../../package.json'), 'utf8')) as { version?: string };
      this.versionCache = String(pkg.version ?? '0.0.0');
    } catch {
      this.versionCache = '0.0.0';
    }
    return this.versionCache;
  }
}
