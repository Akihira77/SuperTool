/**
 * Penyusun dokumen pratinjau HTML Studio.
 *
 * Sumber pengguna tetap utuh di tab HTML. CSS/JS dari tab terpisah disuntikkan
 * hanya saat menyusun dokumen pratinjau/ekspor, ditandai `data-st-html-studio`,
 * dan blok bertanda itu dibuang lebih dulu supaya komposisi berulang tidak
 * menduplikasi gaya/skrip.
 */

export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export const PREVIEW_PRESETS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

export type PreviewPreset = keyof typeof PREVIEW_PRESETS;

export const START_HTML = [
  '<!doctype html>',
  '<html lang="id">',
  '<head>',
  '  <meta charset="utf-8">',
  '  <meta name="viewport" content="width=device-width, initial-scale=1">',
  '  <title>Halaman Baru</title>',
  '</head>',
  '<body>',
  '  <h1>Halo, HTML Studio</h1>',
  '  <p>Ubah HTML, CSS, atau JavaScript dan pratinjau langsung berubah.</p>',
  '  <button id="demo">Klik saya</button>',
  '</body>',
  '</html>',
].join('\n');

export const START_CSS = [
  'body {',
  '  margin: 2rem;',
  '  font-family: system-ui, sans-serif;',
  '  color: #111;',
  '}',
  '',
  'button {',
  '  padding: 0.5rem 1rem;',
  '  border-radius: 0.5rem;',
  '}',
].join('\n');

export const START_JS = [
  "document.getElementById('demo')?.addEventListener('click', (event) => {",
  "  event.currentTarget.textContent = 'Berfungsi';",
  '});',
].join('\n');

const MARK = 'data-st-html-studio';
const META = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;

/** Cegah isi mengakhiri tag lebih awal; lihat catatan batasan di modul ini. */
const escapeCloser = (code: string, tag: string) => code.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`);

function stripInjected(html: string): string {
  return html
    .split(META)
    .join('')
    .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '')
    .replace(/<style\s+data-st-html-studio>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<script\s+data-st-html-studio>[\s\S]*?<\/script>\s*/gi, '');
}

function ensureShell(html: string): string {
  if (/<html[\s>]/i.test(html)) return html;
  if (/<body[\s>]/i.test(html)) return `<html><head></head>${html}</html>`;
  return `<html><head></head><body>${html}</body></html>`;
}

function injectAfterHead(doc: string, block: string): string {
  const head = /<head[^>]*>/i.exec(doc);
  if (head) {
    const at = head.index + head[0].length;
    return doc.slice(0, at) + block + doc.slice(at);
  }
  const root = /<html[^>]*>/i.exec(doc);
  if (root) {
    const at = root.index + root[0].length;
    return doc.slice(0, at) + `<head>${block}</head>` + doc.slice(at);
  }
  return block + doc;
}

function injectBefore(doc: string, closing: string, block: string): string {
  const at = doc.toLowerCase().lastIndexOf(closing);
  return at < 0 ? doc + block : doc.slice(0, at) + block + doc.slice(at);
}

/** Dokumen final untuk iframe/ekspor; tidak pernah ditulis balik ke sumber. */
export function composeDocument(html: string, css: string, js: string): string {
  let doc = injectAfterHead(ensureShell(stripInjected(html)), META);
  if (css.trim()) {
    doc = injectBefore(doc, '</head>', `<style ${MARK}>\n${escapeCloser(css, 'style')}\n</style>\n`);
  }
  if (js.trim()) {
    doc = injectBefore(doc, '</body>', `<script ${MARK}>\n${escapeCloser(js, 'script')}\n</script>\n`);
  }
  return doc;
}

export type ImportedHtml = { path: string; name: string; content: string; truncated: boolean };

/** Payload workflow Files → HTML Studio; null berarti ditolak. */
export function parseImportPayload(payload: unknown): ImportedHtml | null {
  if (!payload || typeof payload !== 'object') return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.path !== 'string' || !raw.path.trim()) return null;
  if (typeof raw.content !== 'string') return null;
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name : (raw.path.split('/').pop() ?? raw.path);
  if (!/\.html?$/i.test(name)) return null;
  return { path: raw.path, name, content: raw.content, truncated: raw.truncated === true };
}

export type StudioContent = { html: string; css: string; js: string };
export type StudioBaseline = StudioContent;

export function createBaseline(html = START_HTML, css = START_CSS, js = START_JS): StudioBaseline {
  return { html, css, js };
}

/**
 * `sourceDirty` hanya membandingkan tab HTML, karena hanya tab itu yang ditulis
 * ke berkas sumber. `workspaceDirty` mencakup CSS/JS: perubahan di tab tersebut
 * tetap pekerjaan yang belum tersimpan, hanya bukan ke berkas asal.
 */
export function dirtyState(
  content: StudioContent,
  baseline: StudioBaseline,
): { sourceDirty: boolean; workspaceDirty: boolean } {
  const sourceDirty = content.html !== baseline.html;
  return {
    sourceDirty,
    workspaceDirty: sourceDirty || content.css !== baseline.css || content.js !== baseline.js,
  };
}
