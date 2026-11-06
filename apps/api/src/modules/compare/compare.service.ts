import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { all, db, one } from '../../common/db';

export type CompareHistoryItem = {
  id: number;
  createdAt: number;
  leftLines: number;
  rightLines: number;
  leftPreview: string;
  rightPreview: string;
};

type CompareHistoryRow = {
  id: number;
  createdAt: number;
  leftLines: number;
  rightLines: number;
  leftPreview: string;
  rightPreview: string;
};

const MAX_TEXT_LENGTH = 1_000_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function countLines(text: string): number {
  return text ? text.replace(/\r\n?/g, '\n').split('\n').length : 0;
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function toItem(row: CompareHistoryRow): CompareHistoryItem {
  return {
    id: Number(row.id),
    createdAt: Number(row.createdAt),
    leftLines: Number(row.leftLines),
    rightLines: Number(row.rightLines),
    leftPreview: preview(row.leftPreview),
    rightPreview: preview(row.rightPreview),
  };
}

@Injectable()
export class CompareService {
  list(limitRaw?: string, beforeRaw?: string) {
    const limit = Math.min(Math.max(Number(limitRaw) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const before = Math.floor(Number(beforeRaw));
    const cursor = Number.isFinite(before) && before > 0 ? before : null;
    const take = limit + 1;
    const select =
      'SELECT id, created_at AS createdAt, left_lines AS leftLines, right_lines AS rightLines, ' +
      'substr(left_text, 1, 180) AS leftPreview, substr(right_text, 1, 180) AS rightPreview ' +
      'FROM compare_history ' +
      (cursor ? 'WHERE id < ? ' : '') +
      'ORDER BY id DESC LIMIT ?';
    const rows = cursor
      ? all<CompareHistoryRow>(select, cursor, take)
      : all<CompareHistoryRow>(select, take);
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toItem);
    return {
      items,
      hasMore,
      nextCursor: hasMore && items.length ? items[items.length - 1].id : null,
    };
  }

  save(body: { left?: unknown; right?: unknown }) {
    const left = typeof body?.left === 'string' ? body.left : '';
    const right = typeof body?.right === 'string' ? body.right : '';
    if (!left && !right) throw new BadRequestException('Teks perbandingan kosong.');
    if (left.length > MAX_TEXT_LENGTH || right.length > MAX_TEXT_LENGTH) {
      throw new BadRequestException('Teks terlalu panjang untuk disimpan (maksimal 1 MB per sisi).');
    }

    const latest = one<{ id: number; left_text: string; right_text: string }>(
      'SELECT id, left_text, right_text FROM compare_history ORDER BY id DESC LIMIT 1',
    );
    if (latest && latest.left_text === left && latest.right_text === right) {
      const existing = one<CompareHistoryRow>(
        'SELECT id, created_at AS createdAt, left_lines AS leftLines, right_lines AS rightLines, ' +
          'substr(left_text, 1, 180) AS leftPreview, substr(right_text, 1, 180) AS rightPreview ' +
          'FROM compare_history WHERE id = ?',
        latest.id,
      );
      if (existing) return toItem(existing);
    }

    const createdAt = Date.now();
    const leftLines = countLines(left);
    const rightLines = countLines(right);
    const result = db
      .prepare(
        'INSERT INTO compare_history (created_at, left_text, right_text, left_lines, right_lines) ' +
          'VALUES (?, ?, ?, ?, ?)',
      )
      .run(createdAt, left, right, leftLines, rightLines);
    return {
      id: Number(result.lastInsertRowid),
      createdAt,
      leftLines,
      rightLines,
      leftPreview: preview(left),
      rightPreview: preview(right),
    } satisfies CompareHistoryItem;
  }

  get(idRaw: string) {
    const id = Math.floor(Number(idRaw));
    if (!Number.isFinite(id) || id <= 0) throw new NotFoundException('Riwayat tidak ditemukan.');
    const row = one<CompareHistoryRow & { leftText: string; rightText: string }>(
      'SELECT id, created_at AS createdAt, left_lines AS leftLines, right_lines AS rightLines, ' +
        'substr(left_text, 1, 180) AS leftPreview, substr(right_text, 1, 180) AS rightPreview, ' +
        'left_text AS leftText, right_text AS rightText ' +
        'FROM compare_history WHERE id = ?',
      id,
    );
    if (!row) throw new NotFoundException('Riwayat tidak ditemukan.');
    return { ...toItem(row), leftText: row.leftText, rightText: row.rightText };
  }

  remove(idRaw: string) {
    const id = Math.floor(Number(idRaw));
    if (!Number.isFinite(id) || id <= 0) throw new NotFoundException('Riwayat tidak ditemukan.');
    const changed = Number(db.prepare('DELETE FROM compare_history WHERE id = ?').run(id).changes);
    if (!changed) throw new NotFoundException('Riwayat tidak ditemukan.');
    return { ok: true };
  }
}
