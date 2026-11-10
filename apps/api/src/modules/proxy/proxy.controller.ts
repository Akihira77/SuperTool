import { BadRequestException, Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { assertLocalUrl } from '../../common/net-guard';
import { requestLocal } from '../../common/http-client';
import { AuthService } from '../auth/auth.service';

const STRIP_HEADERS = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'set-cookie'];

function parse(raw: string): URL {
  if (!raw) throw new BadRequestException('Parameter u wajib diisi');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('URL tidak valid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Hanya http/https');
  }
  return url;
}

@Controller('proxy')
export class ProxyController {
  constructor(private readonly auth: AuthService) {}

  /**
   * Tiket untuk iframe mode subdomain. Cookie sesi tidak ikut ke <hex>.localhost,
   * jadi browser membawa tiket ini (terikat origin target) sebagai bearer.
   */
  @Post('ticket')
  async ticket(@Body() body: { origin?: string }) {
    let url: URL;
    try {
      url = new URL(String(body?.origin ?? ''));
    } catch {
      throw new BadRequestException('Origin tidak valid');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Hanya http/https');
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new BadRequestException('origin harus tanpa path/query');
    }
    await assertLocalUrl(url);
    return { ticket: await this.auth.issueProxyTicket(url.origin) };
  }

  /** Cek cepat apakah URL target hidup (dipakai badge status di URL Viewer). */
  @Get('probe')
  async probe(@Query('u') raw: string) {
    let url: URL;
    try {
      url = parse(raw);
      await assertLocalUrl(url);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    try {
      const response = await requestLocal(url.href, { method: 'HEAD', timeoutMs: 5000, maxResponseBytes: 1024 });
      return { ok: response.status < 500, status: response.status };
    } catch (err) {
      const message = (err as Error).message;
      return { ok: false, error: message.includes('fetch failed') ? 'Tidak ada yang mendengarkan di alamat itu' : message };
    }
  }

  /**
   * Mode sederhana: satu halaman lewat query. Untuk aplikasi penuh pakai
   * /api/proxy/b/<token>/... (middleware) yang juga mem-proxy aset & WebSocket.
   */
  @Get()
  async get(@Query('u') raw: string, @Res() res: Response) {
    const url = parse(raw);
    await assertLocalUrl(url);

    const upstream = await requestLocal(url.href, {
      headers: { 'user-agent': 'super-tool-proxy', accept: '*/*' },
      maxResponseBytes: 5_000_000,
    });

    res.status(upstream.status);
    for (const [key, value] of Object.entries(upstream.headers)) {
      const lower = key.toLowerCase();
      if (STRIP_HEADERS.includes(lower) || lower === 'content-encoding') continue;
      res.setHeader(key, value);
    }

    const type = typeof upstream.headers['content-type'] === 'string' ? upstream.headers['content-type'] : '';
    if (!type.includes('text/html')) {
      res.send(upstream.body);
      return;
    }

    const base = url.origin + (url.pathname.replace(/[^/]*$/, '') || '/');
    const html = upstream.body.toString('utf8');
    const injected = html.includes('<head')
      ? html.replace(/<head([^>]*)>/i, '<head$1><base href="' + base + '">')
      : '<base href="' + base + '">' + html;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(injected);
  }
}
