import type { IncomingHttpHeaders } from 'node:http';

/**
 * Satu-satunya kebijakan header untuk seluruh transport proxy (HTTP & WS).
 * Deny-by-default untuk credential Super Tool; upstream tidak boleh menerima
 * identitas browser yang sedang login ke Super Tool.
 */

/** Cookie milik aplikasi: sesi (`st_session`) dan tiket subdomain (`st_proxy`). */
export const APP_COOKIES = new Set(['st_session', 'st_proxy']);

/** Header yang membawa credential/otorisasi milik Super Tool. */
const APP_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-st-csrf']);

/** HTTP hop-by-hop: hanya bermakna untuk koneksi langsung, bukan untuk upstream. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
]);

/** Header konteks browser yang ditetapkan ulang oleh proxy. */
const CONTEXT_HEADERS = new Set(['host', 'origin', 'referer', 'accept-encoding']);

/**
 * Metadata identitas proxy dari caller. Tidak diteruskan: nilai asli bisa
 * memalsukan IP/host di upstream. Kalau upstream butuh, generate dari
 * `req.socket.remoteAddress` setelah ada kebutuhan nyata.
 */
const FORWARDED_METADATA = new Set([
  'forwarded',
  'x-real-ip',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
]);

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** Header handshake WebSocket yang harus ikut ke upstream. */
const WS_HANDSHAKE = new Set([
  'connection',
  'upgrade',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
]);

/** CSP untuk dokumen pihak ketiga yang tetap berjalan di origin Super Tool. */
export const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals';

/** Buang cookie credential Super Tool; cookie aplikasi target tetap diteruskan. */
export function stripCredentialCookies(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const kept: string[] = [];
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const name = (eq < 0 ? trimmed : trimmed.slice(0, eq)).trim().toLowerCase();
    if (APP_COOKIES.has(name)) continue;
    kept.push(trimmed);
  }
  return kept.length ? kept.join('; ') : undefined;
}

function isBrowserContext(key: string): boolean {
  return key.startsWith('sec-fetch-') || key.startsWith('sec-ch-');
}

function isForwardedMetadata(key: string): boolean {
  return FORWARDED_METADATA.has(key) || key.startsWith('x-forwarded-');
}

/**
 * Header yang dinominasikan `Connection` adalah hop-by-hop (RFC 9110 §7.6.1),
 * mis. `Connection: keep-alive, X-Internal-Metadata`. Token tidak valid diabaikan.
 */
function connectionNominated(input: IncomingHttpHeaders): Set<string> {
  const raw = input.connection;
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const out = new Set<string>();
  for (const token of joined.split(',')) {
    const key = token.trim().toLowerCase();
    if (key && HEADER_NAME.test(key)) out.add(key);
  }
  return out;
}

function valueOf(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Header yang boleh dikirim ke upstream pada request HTTP biasa. */
export function upstreamHttpHeaders(input: IncomingHttpHeaders): Record<string, string> {
  const nominated = connectionNominated(input);
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const key = rawKey.toLowerCase();
    if (key === 'cookie') continue;
    if (APP_HEADERS.has(key) || HOP_BY_HOP.has(key) || CONTEXT_HEADERS.has(key)) continue;
    if (WS_HANDSHAKE.has(key) || isBrowserContext(key) || isForwardedMetadata(key)) continue;
    if (nominated.has(key)) continue;
    out[key] = valueOf(value);
  }
  const cookie = stripCredentialCookies(input.cookie);
  if (cookie) out.cookie = cookie;
  return out;
}

/** Header handshake WebSocket: pertahankan `Connection`/`Upgrade` dan `Sec-WebSocket-*`. */
export function upstreamUpgradeHeaders(input: IncomingHttpHeaders): Record<string, string> {
  const nominated = connectionNominated(input);
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const key = rawKey.toLowerCase();
    if (key === 'cookie') continue;
    if (APP_HEADERS.has(key) || CONTEXT_HEADERS.has(key) || isBrowserContext(key)) continue;
    if (isForwardedMetadata(key)) continue;
    if (key === 'connection') continue;
    if (HOP_BY_HOP.has(key) && !WS_HANDSHAKE.has(key)) continue;
    if (key === 'sec-websocket-accept') continue;
    // Header handshake wajib tetap ada walau client menominasikannya lewat Connection.
    if (nominated.has(key) && !WS_HANDSHAKE.has(key)) continue;
    out[key] = valueOf(value);
  }
  // Connection untuk handshake selalu kanonik: token lain dari client dibuang.
  out.connection = 'Upgrade';
  const cookie = stripCredentialCookies(input.cookie);
  if (cookie) out.cookie = cookie;
  return out;
}
