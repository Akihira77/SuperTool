import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { all, db, one, run } from '../../common/db';
import { jailPath } from '../../common/fs-jail';

export type WorkspaceService = { name: string; url: string };
export type WorkspaceShortcut = { label: string; path: string };

/** Metadata proyek. Tidak berisi isi .env atau kredensial. */
export type WorkspaceConfig = {
  gitRepo?: string;
  favoriteUrls?: string[];
  services?: WorkspaceService[];
  tools?: string[];
  shortcuts?: WorkspaceShortcut[];
};

export type Workspace = {
  id: string;
  name: string;
  root: string;
  config: WorkspaceConfig;
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: string;
  name: string;
  root: string;
  config: string;
  created_at: number;
  updated_at: number;
};

const NAME_MAX = 80;
const CONFIG_MAX = 16384;
const URL_MAX = 2000;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function urlOf(value: unknown): string | undefined {
  const raw = text(value, URL_MAX);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
    return url.toString();
  } catch {
    throw new BadRequestException('URL harus http atau https: ' + raw.slice(0, 80));
  }
}

/** Whitelist field yang dikenal; kunci lain (mis. env) diabaikan dan tidak pernah disimpan. */
function sanitizeConfig(input: unknown): WorkspaceConfig {
  if (input === undefined || input === null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Config workspace harus objek');
  const source = input as Record<string, unknown>;
  const config: WorkspaceConfig = {};

  config.gitRepo = text(source.gitRepo, URL_MAX);
  const urls = Array.isArray(source.favoriteUrls) ? source.favoriteUrls.slice(0, 20).map(urlOf) : [];
  config.favoriteUrls = urls.filter((item): item is string => Boolean(item));
  const tools = Array.isArray(source.tools) ? source.tools.slice(0, 30).map((item) => text(item, 40)) : [];
  config.tools = tools.filter((item): item is string => Boolean(item));
  const services = Array.isArray(source.services) ? source.services.slice(0, 20) : [];
  config.services = services
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined;
      const row = item as Record<string, unknown>;
      const name = text(row.name, 60);
      const url = urlOf(row.url);
      return name && url ? { name, url } : undefined;
    })
    .filter((item): item is WorkspaceService => Boolean(item));
  const shortcuts = Array.isArray(source.shortcuts) ? source.shortcuts.slice(0, 30) : [];
  config.shortcuts = shortcuts
    .map((item) => {
      if (!item || typeof item !== 'object') return undefined;
      const row = item as Record<string, unknown>;
      const label = text(row.label, 60);
      const path = text(row.path, URL_MAX);
      return label && path ? { label, path } : undefined;
    })
    .filter((item): item is WorkspaceShortcut => Boolean(item));

  if (Buffer.byteLength(JSON.stringify(config)) > CONFIG_MAX) {
    throw new BadRequestException('Config workspace terlalu besar (maks 16 KB)');
  }
  return config;
}

function parseRow(row: Row): Workspace {
  let config: WorkspaceConfig = {};
  try {
    const parsed = JSON.parse(row.config) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) config = parsed as WorkspaceConfig;
  } catch {
    config = {};
  }
  return { id: row.id, name: row.name, root: row.root, config, createdAt: row.created_at, updatedAt: row.updated_at };
}

@Injectable()
export class WorkspacesService {
  private async checkedPath(input: unknown, label: string): Promise<string> {
    const raw = text(input, URL_MAX);
    if (!raw) throw new BadRequestException(label + ' wajib diisi');
    const abs = await jailPath(raw);
    let info;
    try {
      info = await stat(abs);
    } catch {
      throw new BadRequestException(label + ' tidak ditemukan: ' + abs);
    }
    if (!info.isDirectory()) throw new BadRequestException(label + ' harus berupa direktori');
    return abs;
  }

  private async payload(input: { name?: unknown; root?: unknown; config?: unknown }) {
    const name = text(input.name, NAME_MAX);
    if (!name) throw new BadRequestException('Nama workspace wajib diisi');
    const root = await this.checkedPath(input.root, 'Root proyek');
    const config = sanitizeConfig(input.config);
    if (config.gitRepo) config.gitRepo = await this.checkedPath(config.gitRepo, 'Git repository');
    return { name, root, config };
  }

  list(): Workspace[] {
    return all<Row>('SELECT * FROM workspaces ORDER BY updated_at DESC').map(parseRow);
  }

  get(id: string): Workspace {
    const row = one<Row>('SELECT * FROM workspaces WHERE id = ?', id);
    if (!row) throw new NotFoundException('Workspace tidak ditemukan');
    return parseRow(row);
  }

  async save(input: { id?: string; name?: unknown; root?: unknown; config?: unknown }): Promise<Workspace> {
    const data = await this.payload(input);
    const now = Date.now();
    if (input.id) {
      this.get(input.id);
      run('UPDATE workspaces SET name = ?, root = ?, config = ?, updated_at = ? WHERE id = ?', data.name, data.root, JSON.stringify(data.config), now, input.id);
      return this.get(input.id);
    }
    const id = randomUUID();
    run('INSERT INTO workspaces (id, name, root, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', id, data.name, data.root, JSON.stringify(data.config), now, now);
    return this.get(id);
  }

  async duplicate(id: string): Promise<Workspace> {
    const source = this.get(id);
    const name = (source.name + ' (salinan)').slice(0, NAME_MAX);
    const now = Date.now();
    const copyId = randomUUID();
    run('INSERT INTO workspaces (id, name, root, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', copyId, name, source.root, JSON.stringify(source.config), now, now);
    return this.get(copyId);
  }

  remove(id: string): { ok: true } {
    this.get(id);
    run('DELETE FROM workspaces WHERE id = ?', id);
    return { ok: true };
  }

  exportData(): { version: 1; exportedAt: number; workspaces: Array<Pick<Workspace, 'name' | 'root' | 'config'>> } {
    return {
      version: 1,
      exportedAt: Date.now(),
      workspaces: this.list().map(({ name, root, config }) => ({ name, root, config })),
    };
  }

  async importData(input: unknown): Promise<{ imported: number; skipped: number; errors: string[] }> {
    if (!input || typeof input !== 'object') throw new BadRequestException('Berkas impor tidak valid');
    const source = input as Record<string, unknown>;
    if (source.version !== 1) throw new BadRequestException('Versi impor workspace tidak didukung');
    if (!Array.isArray(source.workspaces)) throw new BadRequestException('Daftar workspace tidak valid');
    if (source.workspaces.length > 50) throw new BadRequestException('Maksimal 50 workspace per impor');

    const prepared: Array<{ name: string; root: string; config: WorkspaceConfig }> = [];
    const errors: string[] = [];
    for (const [index, item] of source.workspaces.entries()) {
      if (!item || typeof item !== 'object') {
        errors.push('Baris ' + (index + 1) + ': bukan objek');
        continue;
      }
      try {
        const row = item as Record<string, unknown>;
        prepared.push(await this.payload({ name: row.name, root: row.root, config: row.config }));
      } catch (err) {
        errors.push('Baris ' + (index + 1) + ': ' + (err instanceof Error ? err.message : String(err)));
      }
    }

    let imported = 0;
    let skipped = 0;
    const now = Date.now();
    db.exec('BEGIN');
    try {
      for (const item of prepared) {
        const exists = one<{ id: string }>('SELECT id FROM workspaces WHERE name = ? AND root = ?', item.name, item.root);
        if (exists) {
          skipped += 1;
          continue;
        }
        run('INSERT INTO workspaces (id, name, root, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', randomUUID(), item.name, item.root, JSON.stringify(item.config), now, now);
        imported += 1;
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return { imported, skipped, errors };
  }
}
