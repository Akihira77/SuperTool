import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { cfg } from '../../config';
import { readJson, writeJson } from '../../common/json-store';

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

/**
 * Catatan disimpan di satu file JSON.
 * ponytail: cukup untuk single-user; pindah ke SQLite kalau butuh banyak penulis / ribuan note.
 */
@Injectable()
export class NotesService {
  private readonly file = join(cfg.dataDir, 'notes.json');
  private queue: Promise<unknown> = Promise.resolve();

  private load(): Promise<Note[]> {
    return readJson<Note[]>(this.file, []);
  }

  /** Serialisasi penulisan supaya tidak ada lost update. */
  private mutate(fn: (notes: Note[]) => Note[]): Promise<Note[]> {
    const run = this.queue.then(async () => {
      const next = fn(await this.load());
      await writeJson(this.file, next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<Omit<Note, 'body'>[]> {
    const notes = await this.load();
    return notes
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ body, ...rest }) => rest);
  }

  async get(id: string): Promise<Note> {
    const note = (await this.load()).find((n) => n.id === id);
    if (!note) throw new NotFoundException('Catatan tidak ditemukan');
    return note;
  }

  async create(input: { title?: string; body?: string }): Promise<Note> {
    const now = Date.now();
    const note: Note = {
      id: randomUUID(),
      title: (input.title ?? 'Catatan baru').slice(0, 200),
      body: input.body ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await this.mutate((notes) => [note, ...notes]);
    return note;
  }

  async update(id: string, patch: { title?: string; body?: string }): Promise<Note> {
    if (patch.title !== undefined && typeof patch.title !== 'string') {
      throw new BadRequestException('Judul harus string');
    }
    let updated: Note | null = null;
    await this.mutate((notes) =>
      notes.map((note) => {
        if (note.id !== id) return note;
        updated = {
          ...note,
          title: patch.title?.slice(0, 200) ?? note.title,
          body: patch.body ?? note.body,
          updatedAt: Date.now(),
        };
        return updated;
      }),
    );
    if (!updated) throw new NotFoundException('Catatan tidak ditemukan');
    return updated;
  }

  async remove(id: string): Promise<{ ok: true }> {
    const before = await this.load();
    const next = before.filter((n) => n.id !== id);
    if (next.length === before.length) throw new NotFoundException('Catatan tidak ditemukan');
    await this.mutate(() => next);
    return { ok: true };
  }
}
