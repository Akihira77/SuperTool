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

function valueOf(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

/** Header yang boleh dikirim ke upstream pada request HTTP biasa. */
export function upstreamHttpHeaders(input: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const key = rawKey.toLowerCase();
    if (key === 'cookie') continue;
    if (APP_HEADERS.has(key) || HOP_BY_HOP.has(key) || CONTEXT_HEADERS.has(key)) continue;
    if (WS_HANDSHAKE.has(key) || isBrowserContext(key)) continue;
    out[key] = valueOf(value);
  }
  const cookie = stripCredentialCookies(input.cookie);
  if (cookie) out.cookie = cookie;
  return out;
}

/** Header handshake WebSocket: pertahankan `Connection`/`Upgrade` dan `Sec-WebSocket-*`. */
export function upstreamUpgradeHeaders(input: IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const key = rawKey.toLowerCase();
    if (key === 'cookie') continue;
    if (APP_HEADERS.has(key) || CONTEXT_HEADERS.has(key) || isBrowserContext(key)) continue;
    if (HOP_BY_HOP.has(key) && !WS_HANDSHAKE.has(key)) continue;
    if (key === 'sec-websocket-accept') continue;
    out[key] = valueOf(value);
  }
  const cookie = stripCredentialCookies(input.cookie);
  if (cookie) out.cookie = cookie;
  return out;
}
