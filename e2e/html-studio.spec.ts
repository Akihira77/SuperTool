import { expect, test, type Locator, type Page } from './support/fixtures';
import { audit } from './support/a11y';
import { openTool, signIn } from './support/auth';
import { seedHtmlFile } from './support/seed';

// Panel sesi aktif; panel tab editor di dalamnya juga role="tabpanel".
const panel = (page: Page) => page.locator('[role="tabpanel"]:not([aria-hidden="true"])').first();

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

/** CodeMirror merender konten di contenteditable, bukan textarea. */
const editorText = async (editor: Locator) =>
  (
    await editor.evaluate((el) =>
      Array.from(el.querySelectorAll('.cm-line'))
        // Placeholder dirender sebagai baris semu; itu bukan isi dokumen.
        .map((line) => (line.querySelector('.cm-placeholder') ? '' : (line.textContent ?? '')))
        .join('\n'),
    )
  )
    .replace(/\u200b/g, '')
    .trim();

/** Isi editor bisa tertinggal satu frame setelah aksi; tunggu sampai cocok. */
async function expectEditorText(editor: Locator, expected: string | RegExp) {
  if (typeof expected === 'string') await expect.poll(() => editorText(editor)).toBe(expected);
  else await expect.poll(() => editorText(editor)).toMatch(expected);
}

const sessionTab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Sesi Super Tool' }).getByRole('tab', { name, exact: true });

/** Dipakai untuk memeriksa apakah penjaga `beforeunload` sedang aktif. */
const unloadBlocked = (page: Page) =>
  page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });

async function openHtmlInStudio(page: Page, name: string) {
  await sessionTab(page, 'File Explorer').click();
  const files = panel(page);
  const back = files.getByRole('button', { name: 'Kembali ke daftar' });
  if (await back.count()) await back.click();
  await files.locator('tbody tr', { hasText: name }).click();
  await files.getByRole('button', { name: 'Buka di HTML Studio' }).click();
  await expect(sessionTab(page, 'HTML Studio')).toHaveAttribute('aria-selected', 'true');
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
  await expectEditorText(studio.getByRole('textbox', { name: 'Editor HTML' }), /PREVIEW-1/);

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
  await expectEditorText(editor, /SEEDED-HTML/);
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
  await expectEditorText(editor, '<p>BELUM-DISIMPAN</p>');

  await studio.getByRole('button', { name: 'Atur ulang' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Atur ulang', exact: true }).click();
  await expectEditorText(editor, /Halo, HTML Studio/);
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

test('HTML Studio: perubahan CSS/JS saja terhitung belum tersimpan', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');
  const studio = panel(page);

  expect(await unloadBlocked(page)).toBe(false);

  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await fillEditor(page, 'Editor CSS', 'body { margin: 9px; }');
  expect(await unloadBlocked(page)).toBe(true);

  // Reset juga menjaga perubahan CSS saja.
  await studio.getByRole('button', { name: 'Atur ulang' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expectEditorText(studio.getByRole('textbox', { name: 'Editor CSS' }), 'body { margin: 9px; }');

  await studio.getByRole('button', { name: 'Atur ulang' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Atur ulang', exact: true }).click();
  expect(await unloadBlocked(page)).toBe(false);

  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();
  await fillEditor(page, 'Editor JavaScript', 'window.flag = 1;');
  expect(await unloadBlocked(page)).toBe(true);
});

test('HTML Studio: impor ulang minta konfirmasi untuk CSS/JS yang belum tersimpan', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  const first = await seedHtmlFile(page.request, app.baseUrl, 'studio-a.html', 'SEED-A');
  const second = await seedHtmlFile(page.request, app.baseUrl, 'studio-b.html', 'SEED-B');

  await openTool(page, 'File Explorer');
  await openHtmlInStudio(page, first.name);

  const studio = panel(page);
  const htmlEditor = studio.getByRole('textbox', { name: 'Editor HTML' });
  const cssEditor = studio.getByRole('textbox', { name: 'Editor CSS' });
  await expectEditorText(htmlEditor, /SEED-A/);
  await expect(studio.getByText('Tersimpan', { exact: true })).toBeVisible();

  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await cssEditor.fill('body { margin: 7px; }');
  await expect(studio.getByText('CSS/JS belum tersimpan', { exact: true })).toBeVisible();

  // Tab HTML tidak berubah, tetapi CSS belum tersimpan: impor lain harus bertanya.
  await openHtmlInStudio(page, second.name);
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await expect(dialog).toBeHidden();
  await expect(studio).toContainText(first.path);
  await expectEditorText(cssEditor, 'body { margin: 7px; }');

  // JavaScript juga dihitung sebelum impor berikutnya.
  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();
  const jsEditor = studio.getByRole('textbox', { name: 'Editor JavaScript' });
  await jsEditor.fill('window.flag = 1;');

  await openHtmlInStudio(page, second.name);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Lanjutkan' }).click();
  await expect(dialog).toBeHidden();

  await expect(studio).toContainText(second.path);
  await expectEditorText(htmlEditor, /SEED-B/);
  await expect(studio.getByText('Tersimpan', { exact: true })).toBeVisible();
  expect(await unloadBlocked(page)).toBe(false);
  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await expectEditorText(cssEditor, '');
  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();
  await expectEditorText(jsEditor, '');
});

test('HTML Studio: simpan hanya HTML dan mempertahankan CSS/JS saat gagal', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  const file = await seedHtmlFile(page.request, app.baseUrl, 'studio-save.html', 'SEED-SAVE');

  await openTool(page, 'File Explorer');
  await openHtmlInStudio(page, file.name);

  const studio = panel(page);
  const htmlEditor = studio.getByRole('textbox', { name: 'Editor HTML' });
  const cssEditor = studio.getByRole('textbox', { name: 'Editor CSS' });
  const saveButton = studio.getByRole('button', { name: 'Simpan', exact: true });

  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await cssEditor.fill('body { margin: 11px; }');
  await expect(studio.getByText('CSS/JS belum tersimpan', { exact: true })).toBeVisible();
  await expect(saveButton).toBeDisabled();

  await studio.getByRole('tab', { name: 'HTML', exact: true }).click();
  await htmlEditor.fill('<!doctype html><html><body><h1 id="updated">UPDATED-SAVE</h1></body></html>');
  await expect(studio.getByText('Belum disimpan', { exact: true })).toBeVisible();
  await saveButton.click();

  await expect(studio.getByText('CSS/JS belum tersimpan', { exact: true })).toBeVisible();
  expect(await unloadBlocked(page)).toBe(true);
  await expect
    .poll(async () => {
      const res = await page.request.get(app.baseUrl + '/api/fs/read?path=' + encodeURIComponent(file.path));
      return ((await res.json()) as { text: string }).text;
    })
    .toContain('UPDATED-SAVE');

  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await expectEditorText(cssEditor, 'body { margin: 11px; }');

  // Simpan gagal tidak boleh menghapus isi editor atau menandai tersimpan.
  await studio.getByRole('tab', { name: 'HTML', exact: true }).click();
  await htmlEditor.fill('<p>GAGAL-SIMPAN</p>');
  await page.route('**/api/fs/write', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'disk penuh' }) }),
  );
  await saveButton.click();
  await expect(studio.getByRole('alert')).toContainText('disk penuh');
  await expectEditorText(htmlEditor, '<p>GAGAL-SIMPAN</p>');
  await expect(studio.getByText('Belum disimpan', { exact: true })).toBeVisible();
  await page.unroute('**/api/fs/write');
});
