import { expect, test, type Page } from './support/fixtures';
import { audit } from './support/a11y';
import { openTool, signIn } from './support/auth';
import { seedHtmlFile } from './support/seed';

const panel = (page: Page) => page.locator('[role="tabpanel"]:not([aria-hidden="true"])');

async function previewFrame(page: Page) {
  const handle = await panel(page).locator('iframe').elementHandle();
  const frame = await handle?.contentFrame();
  if (!frame) throw new Error('iframe pratinjau tidak ditemukan');
  return frame;
}

async function previewEval(page: Page, expression: string) {
  return (await previewFrame(page)).evaluate(expression);
}

async function fillEditor(page: Page, name: string, value: string) {
  await panel(page).getByRole('textbox', { name }).fill(value);
}

test('HTML Studio: pratinjau langsung, tab editor, dan preset viewport', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');
  await audit(page, 'html-studio');

  const studio = panel(page);
  await fillEditor(page, 'Editor HTML', '<!doctype html><html><body><h1 id="live">PREVIEW-1</h1></body></html>');
  await expect.poll(async () => previewEval(page, `document.getElementById('live')?.textContent`)).toBe('PREVIEW-1');

  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await fillEditor(page, 'Editor CSS', 'body { background-color: rgb(1, 2, 3); }');
  await expect
    .poll(async () => previewEval(page, 'getComputedStyle(document.body).backgroundColor'))
    .toBe('rgb(1, 2, 3)');

  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();
  await fillEditor(page, 'Editor JavaScript', `document.body.dataset.ran = 'yes';`);
  await expect.poll(async () => previewEval(page, 'document.body.dataset.ran')).toBe('yes');

  await studio.getByRole('tab', { name: 'HTML', exact: true }).click();
  await expect(studio.getByRole('textbox', { name: 'Editor HTML' })).toHaveValue(/PREVIEW-1/);

  const preview = studio.locator('iframe');
  await studio.getByRole('group', { name: 'Ukuran pratinjau' }).getByRole('button', { name: 'Mobile', exact: true }).click();
  await expect(preview).toHaveAttribute('data-preset', 'mobile');
  const box = await preview.boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(391);

  const download = page.waitForEvent('download');
  await studio.getByRole('button', { name: 'Ekspor HTML' }).click();
  expect((await download).suggestedFilename()).toBe('index.html');
});

test('HTML Studio: pratinjau tidak bisa menyentuh aplikasi atau jaringan luar', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const external: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('example.com')) external.push(response.url());
  });

  const hostile = [
    '<!doctype html><html><body>',
    '<img id="ext" src="https://example.com/pixel.png" alt="">',
    '<script>',
    'const out = [];',
    "try { parent.document.getElementById('root').setAttribute('data-sentinel', 'hijacked'); parent.document.body.innerHTML = 'HIJACKED'; out.push('parent-allowed'); } catch { out.push('parent-blocked'); }",
    "try { localStorage.setItem('st-leak', '1'); out.push('storage-allowed'); } catch { out.push('storage-blocked'); }",
    "try { top.location.href = '/login'; out.push('nav-allowed'); } catch { out.push('nav-blocked'); }",
    "try { out.push(window.open('/popup') === null ? 'popup-blocked' : 'popup-allowed'); } catch { out.push('popup-blocked'); }",
    "fetch('https://example.com/leak').then(() => { document.body.dataset.net = 'allowed'; }, () => { document.body.dataset.net = 'blocked'; });",
    "document.body.dataset.probe = out.join(',');",
    '</script></body></html>',
  ].join('\n');

  await page.evaluate(() => document.getElementById('root')?.setAttribute('data-sentinel', 'intact'));
  await fillEditor(page, 'Editor HTML', hostile);
  await expect.poll(async () => previewEval(page, 'document.body.dataset.net')).toBe('blocked');
  await expect.poll(async () => previewEval(page, 'document.body.dataset.probe')).toContain('parent-blocked');

  const probe = String(await previewEval(page, 'document.body.dataset.probe'));
  expect(probe).toContain('parent-blocked');
  expect(probe).toContain('storage-blocked');
  expect(probe).toContain('popup-blocked');
  expect(probe).not.toContain('allowed');

  const previewEl = panel(page).locator('iframe');
  await expect(previewEl).toHaveAttribute('sandbox', 'allow-scripts');
  expect(await previewEval(page, `(() => { try { return document.cookie === '' ? 'empty' : 'leak'; } catch { return 'blocked'; } })()`)).not.toBe('leak');

  expect(await page.evaluate(() => document.getElementById('root')?.getAttribute('data-sentinel'))).toBe('intact');
  expect(page.url()).not.toContain('/login');
  await expect(page.getByRole('navigation')).toBeVisible();
  expect(await previewEval(page, `document.getElementById('ext').naturalWidth`)).toBe(0);
  expect(external).toEqual([]);
});

test('HTML Studio: buka dari File Explorer, simpan, dan konfirmasi perubahan', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  const file = await seedHtmlFile(page.request, app.baseUrl);

  await openTool(page, 'File Explorer');
  const files = panel(page);
  const row = files.locator('tbody tr', { hasText: file.name });
  await expect(row).toHaveCount(1);
  await row.click();
  await files.getByRole('button', { name: 'Buka di HTML Studio' }).click();
  await expect(
    page.getByRole('tablist', { name: 'Sesi Super Tool' }).getByRole('tab', { name: 'HTML Studio' }),
  ).toHaveAttribute('aria-selected', 'true');

  const studio = panel(page);
  const editor = studio.getByRole('textbox', { name: 'Editor HTML' });
  await expect(editor).toHaveValue(/SEEDED-HTML/);
  await expect.poll(async () => previewEval(page, `document.getElementById('seeded')?.textContent`)).toBe('SEEDED-HTML');

  await editor.fill('<!doctype html><html><body><h1 id="updated">UPDATED</h1></body></html>');
  await studio.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(studio.getByText('Tersimpan', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const res = await page.request.get(app.baseUrl + '/api/fs/read?path=' + encodeURIComponent(file.path));
      return ((await res.json()) as { text: string }).text;
    })
    .toContain('UPDATED');

  // Perubahan belum disimpan tidak boleh hilang tanpa konfirmasi.
  await editor.fill('<p>BELUM-DISIMPAN</p>');
  await studio.getByRole('button', { name: 'Atur ulang' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(editor).toHaveValue('<p>BELUM-DISIMPAN</p>');

  await studio.getByRole('button', { name: 'Atur ulang' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Atur ulang', exact: true }).click();
  await expect(editor).toHaveValue(/Halo, HTML Studio/);
});

test('HTML Studio: tetap terpakai di 390 tanpa overflow dokumen', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');
  await page.setViewportSize({ width: 390, height: 844 });

  const studio = panel(page);
  const overflow = () =>
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await expect(studio.getByRole('tab', { name: 'HTML', exact: true })).toBeVisible();
  expect(await overflow()).toBe(0);

  await studio.getByRole('group', { name: 'Mode tampilan' }).getByRole('button', { name: 'Pratinjau' }).click();
  await expect(studio.locator('iframe')).toBeVisible();
  expect(await overflow()).toBe(0);

  await studio.getByRole('group', { name: 'Mode tampilan' }).getByRole('button', { name: 'Editor' }).click();
  await expect(studio.getByRole('textbox', { name: 'Editor HTML' })).toBeVisible();
  expect(await overflow()).toBe(0);
});

test('HTML Studio: label aksesibel mengikuti bahasa tanpa reload', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  await expect(studio.getByRole('button', { name: 'Atur ulang' })).toBeVisible();
  await expect(studio.getByRole('textbox', { name: 'Editor HTML' })).toBeVisible();

  await page.getByRole('group', { name: 'Bahasa' }).getByRole('button', { name: 'EN' }).click();
  await expect(studio.getByRole('button', { name: 'Reset', exact: true })).toBeVisible();
  await expect(studio.getByRole('tablist', { name: 'Document editors' })).toBeVisible();
  await expect(studio.getByRole('textbox', { name: 'HTML editor' })).toBeVisible();
  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await expect(studio.getByRole('textbox', { name: 'CSS editor' })).toBeVisible();
});
