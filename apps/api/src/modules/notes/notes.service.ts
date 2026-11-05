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

export type NoteSearchScope = 'all' | 'title' | 'body';
export type NoteListItem = Omit<Note, 'body'> & { snippet?: string };

/** Potongan isi di sekitar kata yang dicari, untuk hasil pencarian. */
function bodySnippet(body: string, query: string): string | undefined {
  const index = body.toLowerCase().indexOf(query.toLowerCase());
  if (index < 0) return undefined;
  const start = Math.max(0, index - 50);
  const end = Math.min(body.length, index + query.length + 90);
  const text = body.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + text + (end < body.length ? '…' : '');
}

/** Catatan disimpan di tabel notes (SQLite). */
@Injectable()
export class NotesService {
  async list(query?: string, scope?: string): Promise<NoteListItem[]> {
    const q = (query ?? '').trim().slice(0, 200);
    if (!q) {
      return all<NoteListItem>(
        'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt FROM notes ORDER BY updated_at DESC',
      );
    }
    const mode: NoteSearchScope = scope === 'title' || scope === 'body' ? scope : 'all';
    const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const where =
      mode === 'title'
        ? "title LIKE ? ESCAPE '\\'"
        : mode === 'body'
          ? "body LIKE ? ESCAPE '\\'"
          : "(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')";
    const params = mode === 'all' ? [pattern, pattern] : [pattern];
    const rows = all<Omit<Note, 'body'> & { body: string }>(
      `SELECT id, title, body, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE ${where} ORDER BY updated_at DESC`,
      ...params,
    );
    return rows.map(({ body, ...note }) =>
      mode === 'title' ? note : { ...note, snippet: bodySnippet(body, q) },
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
