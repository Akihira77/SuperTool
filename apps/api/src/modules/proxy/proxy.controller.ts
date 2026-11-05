import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { assertLocalUrl } from '../../common/net-guard';

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
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
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

    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'super-tool-proxy', accept: '*/*' },
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (STRIP_HEADERS.includes(lower) || lower === 'content-encoding') return;
      res.setHeader(key, value);
    });

    const type = upstream.headers.get('content-type') ?? '';
    if (!type.includes('text/html')) {
      res.send(Buffer.from(await upstream.arrayBuffer()));
      return;
    }

    const base = url.origin + (url.pathname.replace(/[^/]*$/, '') || '/');
    const html = await upstream.text();
    const injected = html.includes('<head')
      ? html.replace(/<head([^>]*)>/i, '<head$1><base href="' + base + '">')
      : '<base href="' + base + '">' + html;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(injected);
  }
}
