import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import type { AuthService } from '../auth/auth.service';
import { assertLocalUrl } from '../../common/net-guard';

export const PROXY_PREFIX = '/api/proxy/b/';
const DROP_REQUEST_HEADERS = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'origin', 'referer', 'sec-fetch-site']);
const DROP_RESPONSE_HEADERS = new Set([
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'content-length',
  'set-cookie',
]);

const HTML_HEAD = /<head([^>]*)>/i;
const ATTR_ROOT = /(src|href|action)="\/(?!\/)/g;
const ATTR_ROOT_SINGLE = /(src|href|action)='\/(?!\/)/g;
const CSS_URL_ROOT = /url\((['"]?)\/(?!\/)/g;

function tokenFor(origin: string): string {
  return Buffer.from(origin).toString('base64url');
}

export function originFromToken(token: string): string | null {
  try {
    const origin = Buffer.from(token, 'base64url').toString('utf8');
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function proxyBase(origin: string): string {
  return PROXY_PREFIX + tokenFor(origin) + '/';
}

/** Ubah URL target jadi URL lewat proxy. */
export function proxyUrl(origin: string, raw: string): string {
  const base = origin.endsWith('/') ? origin : origin + '/';
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return raw;
  }
  if (url.origin !== new URL(origin).origin) return raw;
  return PROXY_PREFIX + tokenFor(url.origin) + url.pathname + url.search;
}

function rewriteHtml(html: string, origin: string, token: string): string {
  const prefix = PROXY_PREFIX + token;
  const base = prefix + '/';
  let out = html;
  if (out.includes(origin)) out = out.split(origin).join(prefix);
  out = out.replace(ATTR_ROOT, '$1="' + base).replace(ATTR_ROOT_SINGLE, "$1='" + base);
  const inject = '<base href="' + base + '">';
  return HTML_HEAD.test(out) ? out.replace(HTML_HEAD, '<head$1>' + inject) : inject + out;
}

function rewriteCookies(cookies: string[], token: string, targetOrigin: string): string[] {
  const path = PROXY_PREFIX + token + '/';
  const insecure = targetOrigin.startsWith('http:');
  return cookies.map((cookie) => {
    let out = cookie
      .replace(/;\s*domain=[^;]*/gi, '')
      .replace(/;\s*path=[^;]*/gi, '; Path=' + path);
    if (!/;\s*path=/i.test(cookie)) out += '; Path=' + path;
    // Target http yang menandai cookie Secure akan dibuang browser karena kita di http.
    if (insecure) out = out.replace(/;\s*secure/gi, '');
    return out;
  });
}

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 30 * 1024 * 1024) throw new Error('Body terlalu besar');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
): Promise<boolean> {
  const rawUrl = req.url ?? '';
  if (!rawUrl.startsWith(PROXY_PREFIX)) return false;

  const session = await auth.session(req.headers.cookie);
  if (!session) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Belum login' }));
    return true;
  }

  const rest = rawUrl.slice(PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  const token = slash < 0 ? rest : rest.slice(0, slash);
  const tail = slash < 0 ? '' : rest.slice(slash + 1);
  const origin = originFromToken(token);
  if (!origin) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Target proxy tidak valid' }));
    return true;
  }

  let target: URL;
  try {
    target = new URL(tail, origin + '/');
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Path proxy tidak valid' }));
    return true;
  }

  try {
    await assertLocalUrl(target);
  } catch (err) {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: (err as Error).message }));
    return true;
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || DROP_REQUEST_HEADERS.has(key)) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  headers.origin = origin;
  headers.referer = origin + '/';

  let body: Buffer | undefined;
  try {
    body = await readBody(req);
  } catch (err) {
    res.writeHead(413, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: (err as Error).message }));
    return true;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: body as unknown as BodyInit | undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Target tidak bisa dihubungi: ' + (err as Error).message }));
    return true;
  }

  const outHeaders: Record<string, string | string[]> = {};
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower)) return;
    if (lower === 'location') {
      outHeaders[key] = proxyUrl(origin, value);
      return;
    }
    outHeaders[key] = value;
  });
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  if (cookies.length) outHeaders['set-cookie'] = rewriteCookies(cookies, token, origin);

  const type = (upstream.headers.get('content-type') ?? '').toLowerCase();
  const buffer = Buffer.from(await upstream.arrayBuffer());

  if (type.includes('text/html')) {
    outHeaders['content-type'] = 'text/html; charset=utf-8';
    res.writeHead(upstream.status, outHeaders);
    res.end(rewriteHtml(buffer.toString('utf8'), origin, token));
    return true;
  }
  if (type.includes('text/css')) {
    res.writeHead(upstream.status, outHeaders);
    res.end(buffer.toString('utf8').replace(CSS_URL_ROOT, 'url($1' + PROXY_PREFIX + token + '/'));
    return true;
  }
  res.writeHead(upstream.status, outHeaders);
  res.end(buffer);
  return true;
}

/** Teruskan WebSocket/upgrade apa pun ke target, supaya terminal & collab tetap jalan. */
export function handleProxyUpgrade(
  req: IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
  auth: AuthService,
): boolean {
  const rawUrl = req.url ?? '';
  if (!rawUrl.startsWith(PROXY_PREFIX)) return false;

  const rest = rawUrl.slice(PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  const token = slash < 0 ? rest : rest.slice(0, slash);
  const tail = slash < 0 ? '' : rest.slice(slash + 1);
  const origin = originFromToken(token);
  if (!origin) {
    socket.destroy();
    return true;
  }

  const target = new URL(tail, origin + '/');
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));

  auth
    .session(req.headers.cookie)
    .then((session) => {
      if (!session) {
        socket.destroy();
        return;
      }
      const upstream = connect({ host, port }, () => {
        const lines = ['GET ' + target.pathname + target.search + ' HTTP/1.1'];
        for (const [key, value] of Object.entries(req.headers)) {
          if (!value) continue;
          if (key === 'host') {
            lines.push('host: ' + target.host);
            continue;
          }
          if (key === 'origin') {
            lines.push('origin: ' + origin);
            continue;
          }
          lines.push(key + ': ' + (Array.isArray(value) ? value.join(', ') : value));
        }
        upstream.write(lines.join('\r\n') + '\r\n\r\n');
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    })
    .catch(() => socket.destroy());
  return true;
}
