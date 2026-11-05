import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { all, one, run } from '../../common/db';

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

/** Catatan disimpan di tabel notes (SQLite). */
@Injectable()
export class NotesService {
  async list(): Promise<Omit<Note, 'body'>[]> {
    return all<Omit<Note, 'body'>>(
      'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM notes ORDER BY updated_at DESC',
    );
  }

  async get(id: string): Promise<Note> {
    const note = one<Note>(
      'SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ?',
      id,
    );
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
    run(
      'INSERT INTO notes (id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      note.id,
      note.title,
      note.body,
      note.createdAt,
      note.updatedAt,
    );
    return note;
  }

  async update(id: string, patch: { title?: string; body?: string }): Promise<Note> {
    if (patch.title !== undefined && typeof patch.title !== 'string') {
      throw new BadRequestException('Judul harus string');
    }
    const current = await this.get(id);
    const next: Note = {
      ...current,
      title: patch.title?.slice(0, 200) ?? current.title,
      body: patch.body ?? current.body,
      updatedAt: Date.now(),
    };
    run('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?', next.title, next.body, next.updatedAt, id);
    return next;
  }

  async remove(id: string): Promise<{ ok: true }> {
    if (run('DELETE FROM notes WHERE id = ?', id) === 0) throw new NotFoundException('Catatan tidak ditemukan');
    return { ok: true };
  }
}
