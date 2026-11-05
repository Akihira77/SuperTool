import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';

export type HookEndpoint = {
  id: string;
  name: string;
  token: string;
  createdAt: number;
};

export type HookItem = {
  id: string;
  endpointId: string;
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
const MAX_ENDPOINTS = 10;
const MAX_BODY = 200 * 1024;

const newToken = () => randomBytes(6).toString('hex');

/**
 * Penangkap webhook: beberapa endpoint sekaligus (masing-masing token sendiri),
 * request disimpan di memori lalu didorong ke UI lewat SSE.
 * ponytail: tanpa database — riwayat memang sementara, cukup untuk mengetes integrasi.
 */
@Injectable()
export class WebhookService {
  private readonly endpoints: HookEndpoint[] = [
    { id: randomBytes(4).toString('hex'), name: 'Endpoint 1', token: newToken(), createdAt: Date.now() },
  ];
  private items: HookItem[] = [];
  private readonly listeners = new Set<Response>();

  info() {
    return { endpoints: this.endpoints, items: this.items };
  }

  create(name?: string) {
    if (this.endpoints.length >= MAX_ENDPOINTS) throw new BadRequestException('Maksimal ' + MAX_ENDPOINTS + ' endpoint');
    const endpoint: HookEndpoint = {
      id: randomBytes(4).toString('hex'),
      name: (name ?? '').trim().slice(0, 40) || 'Endpoint ' + (this.endpoints.length + 1),
      token: newToken(),
      createdAt: Date.now(),
    };
    this.endpoints.push(endpoint);
    this.push();
    return endpoint;
  }

  remove(id: string) {
    const index = this.endpoints.findIndex((endpoint) => endpoint.id === id);
    if (index < 0) throw new NotFoundException('Endpoint tidak ditemukan');
    this.endpoints.splice(index, 1);
    this.items = this.items.filter((item) => item.endpointId !== id);
    this.push();
    return this.info();
  }

  find(token: string) {
    return this.endpoints.find((endpoint) => endpoint.token === token) ?? null;
  }

  clear(endpointId?: string) {
    this.items = endpointId ? this.items.filter((item) => item.endpointId !== endpointId) : [];
    this.push();
    return { ok: true };
  }

  capture(req: Request, endpointId: string) {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
    const body = raw.subarray(0, MAX_BODY).toString('utf8');
    const headers = Object.entries(req.headers).map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
    }));
    const item: HookItem = {
      id: randomBytes(4).toString('hex'),
      endpointId,
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
    res.write('data: ' + JSON.stringify(this.info()) + '\n\n');
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
