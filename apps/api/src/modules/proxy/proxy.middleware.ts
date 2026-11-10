import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import type { AuthService } from '../auth/auth.service';
import { assertLocalUrl } from '../../common/net-guard';
import { streamLocal, type LocalStreamResponse } from '../../common/http-client';

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

const TICKET_PARAM = 'st_ticket';
const TICKET_COOKIE = 'st_proxy';
const REWRITE_LIMIT = 8 * 1024 * 1024;
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

/** Token untuk mode subdomain: heksadesimal, karena nama host selalu di-lowercase browser. */
export function hexToken(origin: string): string {
  return Buffer.from(origin, 'utf8').toString('hex');
}

export function originFromHex(token: string): string | null {
  if (!/^[0-9a-f]+$/i.test(token) || token.length > 63 || token.length % 2) return null;
  try {
    const origin = Buffer.from(token, 'hex').toString('utf8');
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** `<hex>.localhost:3001` → { token, origin }; null kalau host bukan subdomain proxy. */
export function subdomainTarget(host: string | undefined): { token: string; origin: string } | null {
  const hostname = (host ?? '').split(':')[0].toLowerCase();
  const match = /^([0-9a-f]+)\.localhost$/.exec(hostname);
  if (!match) return null;
  const origin = originFromHex(match[1]);
  return origin ? { token: match[1], origin } : null;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** Tiket subdomain dari query (kunjungan pertama) atau cookie host itu. */
function proxyTicket(req: IncomingMessage): string | undefined {
  let fromQuery: string | null = null;
  try {
    fromQuery = new URL(req.url ?? '/', 'http://proxy.local').searchParams.get(TICKET_PARAM);
  } catch {
    // URL rusak: biarkan verifikasi gagal.
  }
  return fromQuery ?? cookieValue(req.headers.cookie, TICKET_COOKIE);
}

/** URL aplikasi di subdomain proxy (mode yang membuat cookie & path absolut bekerja). */
export function subdomainUrl(origin: string, port: string): string | null {
  const token = hexToken(origin);
  if (token.length > 63) return null;
  return 'http://' + token + '.localhost' + (port && port !== '80' ? ':' + port : '') + '/';
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

/** Baca stream sampai batas; null kalau lewat (jangan buffer seluruh respons raksasa). */
async function readLimited(stream: ReadableStream<Uint8Array>, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) {
      await stream.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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

type Target = {
  kind: 'path' | 'sub';
  token: string;
  origin: string;
  /** URL target lengkap. */
  target: URL;
  /** Prefix yang dipakai aplikasi ('' untuk mode subdomain). */
  prefix: string;
  /** Origin publik tempat iframe berjalan (dipakai untuk menulis ulang URL absolut). */
  publicOrigin: string;
};

function resolveTarget(req: IncomingMessage): Target | null {
  const host = req.headers.host;
  const sub = subdomainTarget(host);
  if (sub) {
    const port = (host ?? '').split(':')[1] ?? '';
    const url = req.url && req.url.startsWith('/') ? req.url : '/' + (req.url ?? '');
    let target: URL;
    try {
      target = new URL(url, sub.origin + '/');
    } catch {
      return null;
    }
    if (target.origin !== sub.origin) return null;
    return {
      kind: 'sub',
      token: sub.token,
      origin: sub.origin,
      target,
      prefix: '',
      publicOrigin: 'http://' + sub.token + '.localhost' + (port && port !== '80' ? ':' + port : ''),
    };
  }

  const rawUrl = req.url ?? '';
  if (!rawUrl.startsWith(PROXY_PREFIX)) return null;
  const rest = rawUrl.slice(PROXY_PREFIX.length);
  const slash = rest.indexOf('/');
  const token = slash < 0 ? rest : rest.slice(0, slash);
  const tail = slash < 0 ? '' : rest.slice(slash + 1);
  const origin = originFromToken(token);
  if (!origin) return null;
  let target: URL;
  try {
    target = new URL(tail, origin + '/');
  } catch {
    return null;
  }
  if (target.origin !== origin) return null;
  return {
    kind: 'path',
    token,
    origin,
    target,
    prefix: PROXY_PREFIX + token + '/',
    publicOrigin: PROXY_PREFIX + token,
  };
}

/** Variasi origin target yang sering ditulis di dalam JS (localhost vs 127.0.0.1). */
function originVariants(origin: string): string[] {
  const url = new URL(origin);
  const hosts = new Set<string>([url.hostname]);
  if (url.hostname === '127.0.0.1') hosts.add('localhost');
  if (url.hostname === 'localhost') hosts.add('127.0.0.1');
  const variants = new Set<string>([origin]);
  for (const host of hosts) variants.add(url.protocol + '//' + host + (url.port ? ':' + url.port : ''));
  return [...variants];
}

/**
 * Aplikasi SPA kadang menyimpan alamat API-nya sebagai URL absolut di bundel JS
 * (contoh Chroma UI: `http://localhost:8000/api/v2`). Dari iframe, URL seperti itu
 * jadi lintas origin lalu diblokir browser ("Network Error"). Di mode subdomain
 * alamat tersebut ditukar ke origin proxy supaya kembali satu origin.
 */
function rewriteOrigins(text: string, origin: string, base: string): string {
  let out = text;
  for (const variant of originVariants(origin)) {
    if (out.includes(variant)) out = out.split(variant).join(base);
  }
  return out;
}

function rewriteHtmlFor(html: string, origin: string, base: string, subMode: boolean): string {
  const out = rewriteOrigins(html, origin, base);
  if (subMode) return out;
  const injected = out.replace(ATTR_ROOT, '$1="' + base + '/').replace(ATTR_ROOT_SINGLE, "$1='" + base + "/");
  const inject = '<base href="' + base + '/">';
  return HTML_HEAD.test(injected) ? injected.replace(HTML_HEAD, '<head$1>' + inject) : inject + injected;
}

function rewriteCookiesFor(cookies: string[], target: Target): string[] {
  const insecure = target.origin.startsWith('http:');
  return cookies.map((raw) => {
    let out = raw.replace(/;\s*domain=[^;]*/gi, '');
    if (target.kind === 'path') {
      out = out.replace(/;\s*path=[^;]*/gi, '; Path=' + target.prefix);
      if (!/;\s*path=/i.test(raw)) out += '; Path=' + target.prefix;
    }
    // Target http yang menandai cookie Secure akan dibuang browser karena kita di http.
    if (insecure) out = out.replace(/;\s*secure/gi, '');
    if (target.kind === 'sub') {
      // iframe lintas host: tanpa SameSite=None cookie sesi tidak dipakai di konteks pihak ketiga.
      // localhost diperlakukan sebagai secure context, jadi Secure boleh dipasang walau http.
      out = out.replace(/;\s*samesite=[^;]*/gi, '') + '; SameSite=None; Secure';
    }
    return out;
  });
}

export async function handleProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
): Promise<boolean> {
  const targetInfo = resolveTarget(req);
  if (!targetInfo) {
    const rawUrl = req.url ?? '';
    const isSubHost = /^[0-9a-f]+\.localhost$/i.test((req.headers.host ?? '').split(':')[0]);
    if (!rawUrl.startsWith(PROXY_PREFIX) && !isSubHost) return false;
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Target proxy tidak valid' }));
    return true;
  }

  const { origin, target } = targetInfo;

  // Mode subdomain punya cookie sendiri per host, jadi sesi aplikasi tidak ikut.
  // Izinnya tiket bearer yang terikat origin target (diminta frontend setelah login).
  if (targetInfo.kind === 'sub') {
    const ticket = proxyTicket(req);
    if (!(await auth.verifyProxyTicket(ticket, origin))) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Tiket proxy tidak valid' }));
      return true;
    }
    const parsed = new URL(req.url ?? '/', 'http://proxy.local');
    if (parsed.searchParams.has(TICKET_PARAM)) {
      parsed.searchParams.delete(TICKET_PARAM);
      const location = parsed.pathname + parsed.search;
      res.writeHead(302, {
        location,
        'set-cookie': TICKET_COOKIE + '=' + ticket + '; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=43200',
        'cache-control': 'no-store',
      });
      res.end();
      return true;
    }
  } else {
    const session = await auth.session(req.headers.cookie);
    if (!session) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Belum login' }));
      return true;
    }
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

  let upstream: LocalStreamResponse;
  try {
    upstream = await streamLocal(target.href, {
      method: req.method,
      headers,
      body,
      timeoutMs: 120_000,
    });
  } catch (err) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Target tidak bisa dihubungi: ' + (err as Error).message }));
    return true;
  }

  const subMode = targetInfo.kind === 'sub';
  const outHeaders: Record<string, string | string[]> = {};
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (DROP_RESPONSE_HEADERS.has(lower)) return;
    if (lower === 'location') {
      if (subMode) {
        // Redirect absolut ke target asli dialihkan ke host proxy supaya tetap satu origin.
        outHeaders[key] = value.startsWith(origin) ? targetInfo.publicOrigin + value.slice(origin.length) : value;
      } else {
        outHeaders[key] = proxyUrl(origin, value);
      }
      return;
    }
    outHeaders[key] = value;
  });
  if (upstream.setCookies.length) outHeaders['set-cookie'] = rewriteCookiesFor(upstream.setCookies, targetInfo);

  const type = (upstream.headers.get('content-type') ?? '').toLowerCase();
  const rewrite =
    type.includes('text/html') ||
    (type.includes('text/css') && !subMode) ||
    (subMode && /(javascript|ecmascript|json|text\/plain)/.test(type));

  // Respons non-teks (gambar, font, wasm, media) tidak perlu di-rewrite: alirkan langsung.
  if (!rewrite && upstream.body) {
    res.writeHead(upstream.status, outHeaders);
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream)
      .on('error', () => res.destroy())
      .pipe(res);
    return true;
  }

  const buffer = upstream.body ? await readLimited(upstream.body as import('node:stream/web').ReadableStream, REWRITE_LIMIT) : Buffer.alloc(0);
  if (!buffer) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'Respons target terlalu besar untuk ditulis ulang' }));
    return true;
  }

  // Bundel JS / respons JSON juga bisa memuat URL absolut ke origin target.
  if (subMode && /(javascript|ecmascript|json|text\/plain)/.test(type)) {
    const rewritten = rewriteOrigins(buffer.toString('utf8'), origin, targetInfo.publicOrigin);
    if (rewritten !== buffer.toString('utf8')) {
      outHeaders['content-length'] = String(Buffer.byteLength(rewritten));
      res.writeHead(upstream.status, outHeaders);
      res.end(rewritten);
      return true;
    }
  }

  if (type.includes('text/html')) {
    outHeaders['content-type'] = 'text/html; charset=utf-8';
    if (!subMode) {
      // Path mode tetap satu origin dengan aplikasi; CSP sandbox memaksa dokumen
      // pihak ketiga jadi origin opaque walau dibuka langsung di tab baru.
      outHeaders['content-security-policy'] =
        "sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals";
    }
    res.writeHead(upstream.status, outHeaders);
    res.end(rewriteHtmlFor(buffer.toString('utf8'), origin, targetInfo.publicOrigin, subMode));
    return true;
  }
  if (type.includes('text/css') && !subMode) {
    res.writeHead(upstream.status, outHeaders);
    res.end(buffer.toString('utf8').replace(CSS_URL_ROOT, 'url($1' + targetInfo.prefix));
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
  const targetInfo = resolveTarget(req);
  if (!targetInfo) return false;
  const { origin, target } = targetInfo;

  const refuse = (status: number, message: string) => {
    socket.end('HTTP/1.1 ' + status + ' Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n' + message);
  };

  const connectUpstream = async () => {
    try {
      await assertLocalUrl(target);
    } catch (err) {
      refuse(403, (err as Error).message);
      return;
    }
    const host = target.hostname.replace(/^\[|\]$/g, '');
    const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
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
  };

  if (targetInfo.kind === 'sub') {
    const ticket = proxyTicket(req);
    void auth
      .verifyProxyTicket(ticket, origin)
      .then((ok) => {
        if (!ok) {
          refuse(401, 'Tiket proxy tidak valid');
          return;
        }
        // Jangan teruskan tiket ke target.
        target.searchParams.delete(TICKET_PARAM);
        void connectUpstream();
      })
      .catch(() => socket.destroy());
    return true;
  }

  auth
    .session(req.headers.cookie)
    .then((session) => {
      if (!session) {
        socket.destroy();
        return;
      }
      void connectUpstream();
    })
    .catch(() => socket.destroy());
  return true;
}