import { expect, test } from './support/fixtures';
import { openTool, signIn } from './support/auth';

const VIEW_NAME = 'Mock E2E';

function tokenFor(origin: string): string {
  return Buffer.from(origin).toString('base64url');
}

test('E2E-03 proxy mode path memuat upstream lokal', async ({ page, app, upstream }) => {
  await signIn(page, app);
  await openTool(page, 'URL Viewer');

  await page.getByLabel('Nama tampilan').fill(VIEW_NAME);
  await page.getByLabel('URL', { exact: true }).fill(upstream.origin);
  await page.getByRole('button', { name: 'Tambah URL' }).click();

  const entry = page.getByRole('button', { name: new RegExp('^' + VIEW_NAME + ' ') });
  await expect(entry).toHaveAttribute('aria-current', 'true');

  const proxyButton = page.getByRole('button', { name: 'Proxy', exact: true });
  await proxyButton.click();
  await expect(proxyButton).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Path', exact: true }).click();

  const iframe = page.locator(`iframe[title="${VIEW_NAME}"]`);
  const frame = page.frameLocator(`iframe[title="${VIEW_NAME}"]`);
  await expect(frame.getByRole('heading', { name: 'MOCK-UPSTREAM-OK' })).toBeVisible();
  await expect(frame.getByText('konten dari upstream lokal')).toBeVisible();

  // Path mode: origin opak (sandbox tanpa allow-same-origin).
  const sandbox = await iframe.getAttribute('sandbox');
  expect(sandbox).toContain('allow-scripts');
  expect(sandbox).not.toContain('allow-same-origin');

  const src = (await iframe.getAttribute('src')) ?? '';
  expect(src.startsWith('/api/proxy/b/')).toBe(true);

  // Kontrak keamanan: respons proxy membawa CSP sandbox.
  const proxied = await page.request.get(app.baseUrl + src);
  expect(proxied.status()).toBe(200);
  expect(proxied.headers()['content-security-policy']).toBe(
    'sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals',
  );

  // Aplikasi utama tetap bisa dipakai setelah membuka proxy.
  await openTool(page, 'Catatan');
  await expect(page.getByRole('tab', { name: 'URL Viewer', exact: true })).toBeVisible();
});

test('E2E-03 proxy menolak permintaan tanpa sesi', async ({ playwright, app, upstream }) => {
  const anon = await playwright.request.newContext();
  try {
    const res = await anon.get(`${app.baseUrl}/api/proxy/b/${tokenFor(upstream.origin)}/`);
    expect(res.status()).toBe(401);
  } finally {
    await anon.dispose();
  }
});

test('E2E-03 proxy menolak target di luar kebijakan net guard', async ({ page, app }) => {
  await signIn(page, app);
  const res = await page.request.post(app.baseUrl + '/api/proxy/ticket', {
    data: { origin: 'http://169.254.169.254' },
    headers: { 'x-st-csrf': '1' },
  });
  expect(res.status()).toBe(400);
  expect(await res.text()).toContain('metadata');
});
