import { expect, type APIRequestContext } from '@playwright/test';

/**
 * Data uji deterministik untuk audit state berisi. Semua dibuat lewat API
 * aplikasi sendiri di ST_FS_ROOTS sementara — tidak memakai berkas host dan
 * tidak menyentuh jaringan publik.
 */

const CSRF = { 'x-st-csrf': '1' };

export type SeededFiles = { root: string; longName: string; deepDir: string; bigFile: string; wideFile: string };

async function json<T>(res: Promise<{ ok(): boolean; json(): Promise<unknown>; status(): number }>): Promise<T> {
  const response = await res;
  expect(response.ok(), `seed request gagal: HTTP ${response.status()}`).toBe(true);
  return (await response.json()) as T;
}

export async function fsRoot(request: APIRequestContext, baseUrl: string): Promise<string> {
  const roots = await json<Array<{ path: string }>>(request.get(baseUrl + '/api/fs/roots'));
  return roots[0].path;
}

/** Isi satu folder dengan data "dunia nyata": nama panjang, path dalam, file besar, baris panjang. */
export async function seedFiles(request: APIRequestContext, baseUrl: string): Promise<SeededFiles> {
  const root = await fsRoot(request, baseUrl);
  const write = (path: string, content: string) =>
    request.put(baseUrl + '/api/fs/write', { data: { path, content }, headers: CSRF });

  const longName =
    'laporan-kinerja-tim-platform-infrastruktur-dan-observabilitas-kuartal-empat-tahun-dua-ribu-dua-puluh-enam.md';
  const deepDir = [
    'proyek',
    'klien',
    'internal',
    'platform',
    'observability',
    'dokumentasi',
    'arsip',
    '2026',
  ].reduce((prefix, part) => prefix + '/' + part, root);

  await json(request.post(baseUrl + '/api/fs/mkdir', { data: { path: deepDir }, headers: CSRF }));

  const tableHeader = '| Komponen | Pemilik | Status | Catatan panjang |';
  const tableRows = Array.from({ length: 8 }, (_, index) =>
    `| layanan-observabilitas-${index + 1}-dengan-nama-panjang | tim-platform-${index} | siap | catatan operasional yang cukup panjang untuk menguji pembungkusan tabel |`,
  );
  const markdown = [
    '# Laporan Kinerja',
    '',
    '## Ringkasan',
    '',
    '- [x] Dashboard selesai',
    '- [ ] Dokumentasi',
    '',
    '### Tabel lebar',
    '',
    tableHeader,
    '| --- | --- | --- | --- |',
    ...tableRows,
    '',
    '### Baris kode panjang',
    '',
    '```ts',
    'const konfigurasiObservabilitas = { endpoint: "https://observability.contoh.internal/v1/traces", sampling: 0.25, retensiHari: 30, tim: "platform" };',
    '```',
    '',
    '### Paragraf panjang',
    '',
    'Paragraf ini sengaja dibuat panjang untuk menguji pembungkusan teks pada viewport sempit tanpa membuat halaman melebar secara horizontal. '.repeat(4),
  ].join('\n');

  await json(write(root + '/' + longName, markdown));
  await json(write(deepDir + '/catatan-teknis.md', markdown));

  // Banyak entri supaya daftar punya scrollbar nyata.
  for (let index = 0; index < 40; index += 1) {
    await json(write(`${root}/berkas-${String(index).padStart(2, '0')}-dengan-nama-yang-cukup-panjang.txt`, `baris ${index}\n`));
  }

  // > 2000 baris memicu mode baca (VirtualCode) alih-alih editor penuh.
  const bigFile = root + '/log-panjang-2500-baris.txt';
  await json(write(bigFile, Array.from({ length: 2500 }, (_, index) => `2026-11-23T10:00:${String(index % 60).padStart(2, '0')}Z info request ke /api/tool/${index} selesai`).join('\n')));

  const wideFile = root + '/baris-kode-sangat-panjang.ts';
  await json(
    write(
      wideFile,
      ['const data = ' + JSON.stringify({ kunci: 'nilai'.repeat(120) }) + ';', ...Array.from({ length: 60 }, (_, index) => `export const nilai${index} = ${index};`)].join('\n'),
    ),
  );

  return { root, longName, deepDir, bigFile, wideFile };
}

export type SeededHook = { token: string; count: number };

/** Riwayat webhook: path/header/body panjang, tanpa body, dan banyak item. */
export async function seedWebhook(request: APIRequestContext, baseUrl: string): Promise<SeededHook> {
  // UI memakai endpoint pertama sebagai endpoint aktif; isi endpoint itu agar
  // riwayat langsung terlihat tanpa memilih endpoint lain.
  const info = await json<{ endpoints: Array<{ token: string }> }>(request.get(baseUrl + '/api/webhook'));
  const endpoint = info.endpoints[0]
    ?? await json<{ token: string }>(request.post(baseUrl + '/api/webhook', { data: { name: 'E2E Data Rich' }, headers: CSRF }));
  const hook = (data: unknown, headers: Record<string, string> = {}) =>
    request.post(baseUrl + '/api/hook/' + endpoint.token, { data, headers: { ...CSRF, ...headers } });

  for (let index = 0; index < 12; index += 1) {
    await hook({ index, tool: 'webhook', pesan: 'konten uji berulang' });
  }
  await hook(
    { daftar: Array.from({ length: 40 }, (_, index) => ({ id: index, nama: 'item-dengan-nama-panjang-' + index })) },
    { 'x-keterangan-panjang': 'nilai-header-yang-sangat-panjang-'.repeat(8) },
  );
  await request.post(baseUrl + '/api/hook/' + endpoint.token, {
    data: 'teks biasa tanpa struktur yang cukup panjang '.repeat(20),
    headers: { ...CSRF, 'content-type': 'text/plain' },
  });
  await request.get(baseUrl + '/api/hook/' + endpoint.token + '?query=' + 'nilai-panjang-'.repeat(10));
  return { token: endpoint.token, count: 15 };
}

export const MARKDOWN_FIXTURE = [
  '# Dokumen Uji',
  '',
  '## Bagian',
  '',
  '| Kolom | Nilai |',
  '| --- | --- |',
  '| Nama | ' + 'panjang-'.repeat(20) + ' |',
  '',
  '```ts',
  'const x = "' + 'a'.repeat(160) + '";',
  '```',
  '',
  'Teks ' + 'panjang '.repeat(60),
].join('\n');

export type SeededHtml = { path: string; name: string; content: string };

/** Berkas HTML deterministik untuk alur File Explorer → HTML Studio. */
export async function seedHtmlFile(
  request: APIRequestContext,
  baseUrl: string,
  name = 'studio-demo.html',
  marker = 'SEEDED-HTML',
): Promise<SeededHtml> {
  const root = await fsRoot(request, baseUrl);
  const path = root + '/' + name;
  const content = [
    '<!doctype html>',
    '<html lang="id">',
    '<head><style>h1 { color: rgb(10, 20, 30); }</style></head>',
    '<body><h1 id="seeded">' + marker + '</h1></body>',
    '</html>',
  ].join('\n');
  await json(request.put(baseUrl + '/api/fs/write', { data: { path, content }, headers: CSRF }));
  return { path, name, content };
}
