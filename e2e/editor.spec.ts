import fs from 'node:fs/promises';
import { expect, test, type Locator, type Page } from './support/fixtures';
import { openTool, sessionTab, signIn } from './support/auth';
import { seedHtmlFile } from './support/seed';

// Panel sesi aktif; panel tab editor di dalamnya juga role="tabpanel".
const panel = (page: Page) => page.locator('[role="tabpanel"]:not([aria-hidden="true"])').first();
const activeEditor = (page: Page) => panel(page).locator('[data-action="html-studio:editor"]');

/** Isi dokumen CodeMirror (placeholder bukan konten). */
const editorText = async (editor: Locator) =>
  (
    await editor.evaluate((el) =>
      Array.from(el.querySelectorAll('.cm-line'))
        .map((line) => (line.querySelector('.cm-placeholder') ? '' : (line.textContent ?? '')))
        .join('\n'),
    )
  )
    .replace(/\u200b/g, '')
    .trim();

async function fillEditor(page: Page, name: string, value: string) {
  await panel(page).getByRole('textbox', { name }).fill(value);
}

test('Editor bersama: baris aktif mengikuti kursor dan tetap terlihat saat scroll', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  const editor = activeEditor(page);
  await editor.click();
  await page.keyboard.press('Control+Home');

  const activeLine = studio.locator('.cm-activeLine');
  const activeGutter = studio.locator('.cm-lineNumbers .cm-activeLineGutter');
  await expect(activeLine).toHaveCount(1);
  await expect(activeGutter).toHaveText('1');

  // Indentasi latar berbeda dari baris biasa membuktikan penanda aktif terlihat.
  const read = (handle: 'line' | 'gutter') =>
    studio.locator(handle === 'line' ? '.cm-activeLine' : '.cm-lineNumbers .cm-activeLineGutter').evaluate((el) => {
      const style = getComputedStyle(el);
      return { text: el.textContent ?? '', background: style.backgroundColor, accent: style.boxShadow };
    });
  const activeStyle = await read('line');
  expect(activeStyle.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(activeStyle.text.length).toBeGreaterThan(0);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(activeGutter).toHaveText('3');

  await page.keyboard.press('End');
  await expect(activeGutter).toHaveText('3');
  await page.keyboard.press('ArrowUp');
  await expect(activeGutter).toHaveText('2');

  const total = (await editorText(editor)).split('\n').length;
  await page.keyboard.press('Control+End');
  await expect(activeGutter).toHaveText(String(total));

  // Scroll ikut bergerak: baris aktif tetap di dalam area pandang editor.
  const scroller = await studio.locator('.cm-scroller').boundingBox();
  const line = await activeLine.boundingBox();
  expect(scroller).not.toBeNull();
  expect(line).not.toBeNull();
  expect(line!.y).toBeGreaterThanOrEqual(scroller!.y - 1);
  expect(line!.y + line!.height).toBeLessThanOrEqual(scroller!.y + scroller!.height + 1);
  await expect(activeGutter).toHaveText(String(total));
});

test('Editor bersama: blok HTML, CSS, dan JavaScript bisa dilipat', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  const editor = activeEditor(page);
  const marker = studio.locator('.cm-foldGutter .cm-gutterElement span:visible');
  const placeholder = studio.locator('.cm-foldPlaceholder');

  await expect(marker.first()).toBeVisible();
  await marker.first().click();
  await expect(placeholder).toHaveCount(1);
  await expect(placeholder).toHaveText('…');
  // Dokumen tidak berubah, hanya tampilannya yang dilipat.
  // Rentang lipat HTML menyisakan tag penutup; isi <body> yang disembunyikan.
  const folded = await editorText(editor);
  expect(folded).not.toContain('Halo, HTML Studio');
  await placeholder.click();
  await expect(placeholder).toHaveCount(0);
  expect(await editorText(editor)).toContain('Halo, HTML Studio');

  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await expect(marker.first()).toBeVisible();
  await marker.first().click();
  await expect(placeholder).toHaveCount(1);
  await placeholder.click();
  await expect(placeholder).toHaveCount(0);
  expect(await editorText(activeEditor(page))).toContain('border-radius');

  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();
  await expect(marker.first()).toBeVisible();
  await marker.first().click();
  await expect(placeholder).toHaveCount(1);
  await placeholder.click();
  await expect(placeholder).toHaveCount(0);
  expect(await editorText(activeEditor(page))).toContain('addEventListener');
});

test('Editor bersama: edit setelah fold tidak merusak dokumen', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  const editor = activeEditor(page);
  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();

  const before = await editorText(editor);
  const marker = studio.locator('.cm-foldGutter .cm-gutterElement span:visible');
  await marker.first().click();
  await expect(studio.locator('.cm-foldPlaceholder')).toHaveCount(1);

  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('window.MARK = 1;');

  await studio.locator('.cm-foldPlaceholder').click();
  await expect(studio.locator('.cm-foldPlaceholder')).toHaveCount(0);
  const after = await editorText(editor);
  expect(after).toContain('window.MARK = 1;');
  expect(after).toContain('addEventListener');
  expect(after.length).toBeGreaterThan(before.length);
});

test('HTML Studio: Format Dokumen mengikuti tab aktif', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  const editor = activeEditor(page);
  const formatButton = studio.getByRole('button', { name: 'Format Dokumen' });

  await fillEditor(page, 'Editor HTML', '<main>\n<p>satu</p>\n        <p>dua</p>\n</main>');
  await formatButton.click();
  await expect.poll(() => editorText(editor)).toBe('<main>\n  <p>satu</p>\n  <p>dua</p>\n</main>');

  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await fillEditor(page, 'Editor CSS', 'a{color:red}');
  await formatButton.click();
  await expect.poll(() => editorText(editor)).toBe('a {\n  color: red;\n}');

  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();
  await fillEditor(page, 'Editor JavaScript', 'const a={b:1,c:2}');
  await formatButton.click();
  await expect.poll(() => editorText(editor)).toBe('const a = { b: 1, c: 2 };');

  // Gagal format: pesan jelas, konten sebelumnya tetap utuh.
  await fillEditor(page, 'Editor JavaScript', 'const = ;');
  await formatButton.click();
  await expect(studio.getByText(/Format gagal; konten tidak diubah/)).toBeVisible();
  expect(await editorText(editor)).toBe('const = ;');
});

test('HTML Studio: preferensi format tersimpan setelah reload', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  await studio.getByRole('button', { name: 'Preferensi format' }).click();
  const dialog = studio.getByRole('dialog', { name: 'Preferensi format' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Indentasi' }).click();
  await page.getByRole('option', { name: '4 spasi' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Indentasi' })).toHaveText(/4 spasi/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  const stored = await page.evaluate(() => localStorage.getItem('st:editor:format-preferences:v1'));
  expect(stored).toContain('"tabWidth":4');

  await page.reload();
  await openTool(page, 'HTML Studio');
  const reloaded = panel(page);
  await reloaded.getByRole('tab', { name: 'CSS', exact: true }).click();
  await fillEditor(page, 'Editor CSS', 'a{color:red}');
  await reloaded.getByRole('button', { name: 'Format Dokumen' }).click();
  await expect.poll(() => editorText(activeEditor(page))).toBe('a {\n    color: red;\n}');
});

test('HTML Studio: mengubah preferensi tidak menyentuh isi editor', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  const editor = activeEditor(page);
  await fillEditor(page, 'Editor HTML', '<p>biarkan</p>');
  const before = await editorText(editor);

  await studio.getByRole('button', { name: 'Preferensi format' }).click();
  const dialog = studio.getByRole('dialog', { name: 'Preferensi format' });
  await dialog.getByRole('combobox', { name: 'Kutip JavaScript' }).click();
  await page.getByRole('option', { name: 'Ganda' }).click();
  await page.keyboard.press('Escape');

  expect(await editorText(editor)).toBe(before);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('st:editor:format-preferences:v1'))).toContain(
    '"singleQuote":false',
  );
});

test('HTML Studio: Ctrl+S menyimpan berkas sumber', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  const file = await seedHtmlFile(page.request, app.baseUrl, 'shortcut.html', 'SHORTCUT-BASE');

  await openTool(page, 'File Explorer');
  const files = panel(page);
  await files.locator('tbody tr', { hasText: file.name }).click();
  await files.getByRole('button', { name: 'Buka di HTML Studio' }).click();
  await expect(sessionTab(page, 'HTML Studio')).toHaveAttribute('aria-selected', 'true');

  const editor = activeEditor(page);
  await fillEditor(page, 'Editor HTML', '<p>SHORTCUT-SAVED</p>');
  await editor.click();
  await page.keyboard.press('Control+s');

  await expect
    .poll(async () => {
      const res = await page.request.get(app.baseUrl + '/api/fs/read?path=' + encodeURIComponent(file.path));
      return ((await res.json()) as { text: string }).text;
    })
    .toContain('SHORTCUT-SAVED');
});

test('HTML Studio: Ctrl+S pada draf pratinjau tidak mengunduh diam-diam', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  await expect(studio.getByRole('button', { name: 'Simpan', exact: true })).toHaveCount(0);
  await expect(studio.getByText('Draf pratinjau').first()).toBeVisible();

  let downloaded = false;
  page.on('download', () => {
    downloaded = true;
  });

  const editor = activeEditor(page);
  await fillEditor(page, 'Editor HTML', '<p>DRAF</p>');
  await editor.click();
  await page.keyboard.press('Control+s');
  await expect(page.getByText(/Draf pratinjau tidak punya berkas/)).toBeVisible();
  expect(downloaded).toBe(false);
});

test('HTML Studio: ekspor draf menggabungkan HTML, CSS, dan JavaScript', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'HTML Studio');

  const studio = panel(page);
  await fillEditor(page, 'Editor HTML', '<h1 id="x">GABUNG</h1>');
  await studio.getByRole('tab', { name: 'CSS', exact: true }).click();
  await fillEditor(page, 'Editor CSS', 'h1{color:red}');
  await studio.getByRole('tab', { name: 'JavaScript', exact: true }).click();
  await fillEditor(page, 'Editor JavaScript', 'window.EKSPOR = 1;');

  const downloading = page.waitForEvent('download');
  await studio.getByRole('button', { name: 'Ekspor HTML' }).click();
  const download = await downloading;
  const path = await download.path();
  const doc = await fs.readFile(path, 'utf8');

  expect(download.suggestedFilename()).toBe('index.html');
  expect(doc).toContain('GABUNG');
  expect(doc).toContain('h1{color:red}');
  expect(doc).toContain('window.EKSPOR = 1;');
  expect(doc).toContain('Content-Security-Policy');
});

test('CodeEditor: consumer lama Markdown, JSON, dan Nginx tetap berfungsi', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });

  // Markdown: menulis pada editor bersama tetap memperbarui pratinjau.
  await openTool(page, 'Markdown');
  const markdown = panel(page).locator('[data-action="markdown:editor"]');
  await markdown.fill('# Regresi\n\ntebal');
  await markdown.click();
  const beforeLen = (await markdown.innerText()).length;
  await page.keyboard.press('Control+a');
  await panel(page).getByRole('button', { name: 'B', exact: true }).click();
  // Toolbar membungkus seleksi: panjang bertambah dan dokumen diawali penanda tebal.
  await expect.poll(async () => (await markdown.innerText()).startsWith('**')).toBe(true);
  expect((await markdown.innerText()).length).toBeGreaterThan(beforeLen);
  await markdown.fill('# Regresi\n\ntebal');
  await panel(page).getByRole('button', { name: 'Pratinjau' }).click();
  await expect(panel(page).locator('.md h2')).toHaveText('Regresi');

  // JSON: format lewat editor bersama tetap menulis balik ke dokumen.
  await openTool(page, 'JSON');
  const json = panel(page).locator('[data-action="json:editor"]');
  await json.fill('{"a":1,"b":[2,3]}');
  await panel(page).getByRole('button', { name: 'Rapikan', exact: true }).click();
  await expect.poll(() => json.innerText()).toContain('"a": 1');

  // Nginx: menu konteks memakai seleksi CodeMirror, bukan textarea.
  await openTool(page, 'Nginx');
  const nginx = panel(page).locator('[data-action="nginx:editor"]');
  await nginx.click();
  await page.keyboard.press('Control+a');
  await nginx.click({ button: 'right' });
  await expect(page.getByRole('menu')).toBeVisible();
});

test('CodeEditor: berkas teks dapat dipratinjau dan disunting lewat File Explorer', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  const file = await seedHtmlFile(page.request, app.baseUrl, 'editor-teks.html', 'BARIS-AWAL');

  await openTool(page, 'File Explorer');
  const files = panel(page);
  await files.locator('tbody tr', { hasText: file.name }).click();

  const editor = files.locator('[contenteditable="true"]');
  await expect.poll(async () => (await editor.innerText()).replace(/\u200b/g, '').trim()).toContain('BARIS-AWAL');

  await files.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.fill('BARIS-BARU');
  await editor.click();
  await page.keyboard.press('Control+s');

  await expect
    .poll(async () => {
      const res = await page.request.get(app.baseUrl + '/api/fs/read?path=' + encodeURIComponent(file.path));
      return ((await res.json()) as { text: string }).text;
    })
    .toContain('BARIS-BARU');
});
