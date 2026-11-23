import { expect, test } from './support/fixtures';
import { startApp } from './support/app';
import { audit } from './support/a11y';
import { INITIAL_PASSWORD, openTool, sessionTab, signIn } from './support/auth';

test('D a11y: halaman login dan ganti password', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.baseUrl + '/');
    await expect(page.getByRole('heading', { name: 'Super Tool' })).toBeVisible();
    await audit(page, 'login');

    await page.getByLabel('Password', { exact: true }).fill(INITIAL_PASSWORD);
    await page.getByRole('button', { name: 'Masuk' }).click();
    await expect(page.getByRole('heading', { name: 'Ganti password' })).toBeVisible();
    await audit(page, 'ganti-password');
  } finally {
    await app.stop();
  }
});

test('D a11y: shell, notes, URL viewer, command palette', async ({ page, app }) => {
  await signIn(page, app);
  await audit(page, 'shell');

  await openTool(page, 'Catatan');
  await audit(page, 'notes');

  await openTool(page, 'URL Viewer');
  // Isi iframe adalah dokumen pihak ketiga (sandbox, origin opak) — bukan milik aplikasi.
  await audit(page, 'url-viewer', { exclude: ['iframe'] });

  await openTool(page, 'Catatan');
  await sessionTab(page, 'Catatan').click();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await audit(page, 'command-palette');
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('D keyboard: skip link, fokus dialog, Escape, ARIA tab sesi', async ({ page, app }) => {
  await signIn(page, app);
  // Navigasi baru mereset titik awal tab order ke document start.
  await page.reload();
  await expect(page.getByRole('tablist', { name: 'Sesi Super Tool' })).toBeVisible();

  // Tab pertama harus skip link dan terlihat saat fokus.
  await page.keyboard.press('Tab');
  const focusedText = await page.evaluate(() => document.activeElement?.textContent ?? '');
  expect(focusedText).toContain('Lewati ke konten');
  const skipBox = await page.locator(':focus').boundingBox();
  expect(skipBox?.height ?? 0).toBeGreaterThan(0);

  // Command palette: fokus masuk dialog, Tab terkurung, Escape menutup.
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(
    true,
  );
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(
    true,
  );
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement)))).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  // ARIA tab sesi: role=tab, state aria-selected, satu tab fokusable.
  const tablist = page.getByRole('tablist', { name: 'Sesi Super Tool' });
  await expect(tablist).toBeVisible();
  const tabs = tablist.getByRole('tab');
  const total = await tabs.count();
  expect(total).toBeGreaterThan(0);
  let tabbable = 0;
  for (let index = 0; index < total; index += 1) {
    const tab = tabs.nth(index);
    const selected = await tab.getAttribute('aria-selected');
    expect(['true', 'false']).toContain(selected);
    if ((await tab.getAttribute('tabindex')) === '0') tabbable += 1;
    expect((await tab.getAttribute('aria-label')) ?? '').not.toBe('');
  }
  expect(tabbable).toBe(1);

  // Anak tablist hanya tab. Kontrol tutup ada di toolbar, bukan di dalam tablist.
  await expect(tablist.locator('button:not([role="tab"]), a, input, select, textarea')).toHaveCount(0);
});

test('D markdown: checkbox task-list menyimpan status dan tidak fokusable', async ({ page, app }) => {
  await signIn(page, app);
  await openTool(page, 'Markdown');

  await page.locator('[data-action="markdown:editor"]').fill('- [x] sudah selesai\n- [ ] belum selesai\n');

  const boxes = page.locator('.md input[type="checkbox"]');
  await expect(boxes).toHaveCount(2);
  await expect(boxes.nth(0)).toBeChecked();
  await expect(boxes.nth(1)).not.toBeChecked();
  await expect(boxes.nth(0)).toHaveAttribute('aria-label', 'Tugas selesai');
  await expect(boxes.nth(1)).toHaveAttribute('aria-label', 'Tugas belum selesai');
  await expect(boxes.nth(0)).toBeDisabled();
  await expect(boxes.nth(1)).toBeDisabled();
  expect(await boxes.nth(0).getAttribute('tabindex')).toBe('-1');
  expect(await boxes.nth(1).getAttribute('tabindex')).toBe('-1');
});
