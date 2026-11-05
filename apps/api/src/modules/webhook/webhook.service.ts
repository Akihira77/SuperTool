import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

export type HookItem = {
  id: string;
  method: string;
  path: string;
  query: string;
  ip: string;
  at: number;
  size: number;
  contentType: string;
  headers: Array<{ key: string; value: string }>;
  body: string;
};

const MAX_ITEMS = 100;
const MAX_BODY = 200 * 1024;

/**
 * Penangkap webhook sederhana: semua request ke /api/hook/<token> disimpan di
 * memori lalu didorong ke UI lewat SSE. ponytail: tanpa database — riwayat
 * memang sementara, cukup untuk mengetes integrasi.
 */
@Injectable()
export class WebhookService {
  private readonly token = randomBytes(6).toString('hex');
  private items: HookItem[] = [];
  private readonly listeners = new Set<Response>();

  info() {
    return { token: this.token, path: '/api/hook/' + this.token, items: this.items };
  }

  clear() {
    this.items = [];
    this.push();
    return { ok: true };
  }

  capture(req: Request) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    const body = raw.subarray(0, MAX_BODY).toString('utf8');
    const headers = Object.entries(req.headers).map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
    }));
    const item: HookItem = {
      id: randomBytes(4).toString('hex'),
      method: req.method,
      path: req.originalUrl || req.url,
      query: String(req.url.split('?')[1] ?? ''),
      ip: req.ip ?? '-',
      at: Date.now(),
      size: raw.length,
      contentType: String(req.headers['content-type'] ?? ''),
      headers,
      body,
    };
    this.items.unshift(item);
    if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    this.push();
    return { ok: true, received: item.id };
  }

  subscribe(res: Response) {
    this.listeners.add(res);
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    this.send(res);
    res.on('close', () => this.listeners.delete(res));
  }

  private send(res: Response) {
    res.write('data: ' + JSON.stringify({ items: this.items }) + '\n\n');
  }

  private push() {
    for (const res of this.listeners) {
      try {
        this.send(res);
      } catch {
        this.listeners.delete(res);
      }
    }
  }
}
