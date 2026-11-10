import { BadRequestException } from '@nestjs/common';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { resolveLocalAddress, type ResolvedAddress } from './net-guard';

const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const FORBIDDEN_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'te',
  'trailer',
  'expect',
  'proxy-authorization',
  'proxy-connection',
]);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export type LocalRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
};

export type LocalResponse = {
  status: number;
  statusText: string;
  ms: number;
  size: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  truncated: boolean;
  url: string;
};

type HopOptions = {
  method: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  maxBytes: number;
};

function validateHeaders(input: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input ?? {})) {
    const key = rawKey.trim().toLowerCase();
    const value = String(rawValue);
    if (!HEADER_NAME.test(key)) throw new BadRequestException('Nama header tidak valid: ' + rawKey);
    if (FORBIDDEN_HEADERS.has(key)) throw new BadRequestException('Header tidak diizinkan: ' + rawKey);
    if (/[\r\n]/.test(value)) throw new BadRequestException('Nilai header tidak valid: ' + rawKey);
    out[key] = value;
  }
  return out;
}

function requestOnce(url: URL, address: ResolvedAddress, options: HopOptions): Promise<Omit<LocalResponse, 'ms' | 'url'>> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...options.headers, host: url.host };
    headers['accept-encoding'] = 'identity';
    if (!headers.accept) headers.accept = '*/*';
    if (!headers['user-agent']) headers['user-agent'] = 'super-tool-http';
    if (options.body && !headers['content-type']) headers['content-type'] = 'text/plain; charset=utf-8';
    if (options.body) headers['content-length'] = String(options.body.length);

    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = transport({
      protocol: url.protocol,
      hostname: address.address,
      family: address.family,
      port: url.port || undefined,
      path: url.pathname + url.search,
      method: options.method,
      headers,
      // Pin ke alamat yang sudah lolos validasi; resolver tidak dipanggil lagi.
      lookup: (_hostname, _lookupOptions, callback) => callback(null, address.address, address.family),
      servername: url.protocol === 'https:' ? url.hostname.replace(/^\[|\]$/g, '') : undefined,
    });

    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    req.setTimeout(options.timeoutMs, () => req.destroy(new Error('Request timeout')));
    req.on('error', (err) => fail(err));

    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;

      const done = () => {
        if (settled) return;
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          size,
          headers: res.headers as Record<string, string | string[]>,
          body: Buffer.concat(chunks),
          truncated,
        });
      };

      res.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size <= options.maxBytes) {
          chunks.push(chunk);
          return;
        }
        const remaining = options.maxBytes - (size - chunk.length);
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        truncated = true;
        done();
        res.destroy();
      });
      res.on('end', done);
      res.on('error', (err) => fail(err));
    });

    if (options.body) req.write(options.body);
    req.end();
  });
}

/** Request HTTP(S) dengan redirect manual, validasi SSRF tiap hop, dan batas ukuran respons. */
export async function requestLocal(rawUrl: string, options: LocalRequestOptions = {}): Promise<LocalResponse> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('URL tidak valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BadRequestException('Hanya http/https');
  if (url.username || url.password) throw new BadRequestException('URL tidak boleh memuat kredensial');

  let method = String(options.method ?? 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new BadRequestException('Method tidak didukung: ' + method);
  let body = options.body;
  if (body !== undefined && (method === 'GET' || method === 'HEAD')) body = undefined;
  if (body && Buffer.byteLength(body) > 1_000_000) throw new BadRequestException('Body maksimal 1 MB');
  const headers = validateHeaders(options.headers);
  const maxBytes = Math.min(10_000_000, Math.max(1024, Number(options.maxResponseBytes ?? 1_000_000)));
  const maxRedirects = Math.min(10, Math.max(0, Number(options.maxRedirects ?? 5)));
  const timeoutMs = Math.min(60_000, Math.max(1000, Number(options.timeoutMs ?? 20_000)));
  const deadline = Date.now() + timeoutMs;
  const started = Date.now();

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new BadRequestException('Request timeout');
    const address = await resolveLocalAddress(url);
    const response = await requestOnce(url, address, {
      method,
      headers,
      body: body === undefined ? undefined : Buffer.from(body),
      timeoutMs: remaining,
      maxBytes,
    });

    const location = response.headers.location;
    const redirect = [301, 302, 303, 307, 308].includes(response.status) && typeof location === 'string' && location;
    if (!redirect || typeof location !== 'string') {
      return { ...response, ms: Date.now() - started, url: url.href };
    }
    if (hop === maxRedirects) throw new BadRequestException('Terlalu banyak redirect');
    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new BadRequestException('Redirect tidak valid');
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new BadRequestException('Redirect hanya http/https');
    // Jangan bawa kredensial ke origin lain.
    if (next.origin !== url.origin) {
      delete headers.authorization;
      delete headers.cookie;
    }
    if ((response.status === 303 && method !== 'HEAD') || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
      delete headers['content-type'];
      delete headers['content-length'];
    }
    url = next;
  }
  throw new BadRequestException('Terlalu banyak redirect');
}
