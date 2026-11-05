import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { cfg } from '../../config';

const STRIP_HEADERS = ['x-frame-options', 'content-security-policy', 'content-security-policy-report-only', 'set-cookie'];

/** Hanya localhost / jaringan privat, kecuali ST_PROXY_ALLOW_PUBLIC=1. */
function assertAllowed(url: URL): void {
  if (cfg.proxyAllowPublic) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const privateHost =
    host === 'localhost' ||
    host === '::1' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^f[cd][0-9a-f]{2}:/i.test(host) ||
    /^fe80:/i.test(host);
  if (!privateHost) {
    throw new BadRequestException('Host publik diblokir. Set ST_PROXY_ALLOW_PUBLIC=1 untuk mengizinkan.');
  }
}

@Controller('proxy')
export class ProxyController {
  /** Cek cepat apakah URL target hidup (dipakai badge status di URL Viewer). */
  @Get('probe')
  async probe(@Query('u') raw: string) {
    if (!raw) throw new BadRequestException('Parameter u wajib diisi');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return { ok: false, error: 'URL tidak valid' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, error: 'Hanya http/https' };
    }
    assertAllowed(url);
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(5000) });
      return { ok: response.status < 500, status: response.status };
    } catch (err) {
      const message = (err as Error).message;
      return {
        ok: false,
        error: message.includes('fetch failed') ? 'Tidak ada yang mendengarkan di alamat itu' : message,
      };
    }
  }

  /**
   * Proxy sederhana untuk membuka tool yang mengirim X-Frame-Options / CSP.
   * ponytail: hanya menghapus header + menyuntik <base>. SPA yang memanggil API
   * ke origin aslinya tetap butuh reverse proxy sungguhan (nginx/caddy).
   */
  @Get()
  async get(@Query('u') raw: string, @Res() res: Response) {
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
    assertAllowed(url);

    const upstream = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'super-tool-proxy', accept: '*/*' },
    });

    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (STRIP_HEADERS.includes(key.toLowerCase())) return;
      if (key.toLowerCase() === 'content-encoding') return;
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
