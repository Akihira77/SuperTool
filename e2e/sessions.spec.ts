import { expect, test } from './support/fixtures';
import { openTool, sessionTab, signIn } from './support/auth';

test('E2E-02 sesi: buka dua tool, pindah tab, bertahan setelah reload', async ({ page, app }) => {
  await signIn(page, app);

  await openTool(page, 'Catatan');
  const notesTab = sessionTab(page, 'Catatan');
  await expect(notesTab).toBeVisible();

  await openTool(page, 'JSON');
  const jsonTab = sessionTab(page, 'JSON');
  await expect(jsonTab).toBeVisible();

  // Tool berbeda = sesi berbeda (id tab dan panel berbeda).
  const notesId = await notesTab.getAttribute('id');
  const jsonId = await jsonTab.getAttribute('id');
  expect(notesId).not.toBe(jsonId);

  // Session aktif mengikuti tab yang dipilih.
  await notesTab.click();
  await expect(notesTab).toHaveAttribute('aria-selected', 'true');
  await expect(jsonTab).toHaveAttribute('aria-selected', 'false');
  await expect(page.locator('#notes-panel-notes')).toBeVisible();

  // Kontrak persistence saat ini: susunan & sesi aktif di localStorage.
  await page.reload();
  await expect(sessionTab(page, 'Catatan')).toHaveAttribute('aria-selected', 'true');
  await expect(sessionTab(page, 'JSON')).toBeVisible();
  await expect(page.locator('#notes-panel-notes')).toBeVisible();

  // Pindah ke tab lain tetap berfungsi setelah reload.
  await sessionTab(page, 'JSON').click();
  await expect(sessionTab(page, 'JSON')).toHaveAttribute('aria-selected', 'true');
  // Keyboard: panah kiri memindahkan sesi aktif kembali ke Catatan.
  await page.keyboard.press('ArrowLeft');
  await expect(sessionTab(page, 'Catatan')).toHaveAttribute('aria-selected', 'true');

  // Tutup sesi aktif lewat tombol toolbar (nama aksesibel menyebut sesinya).
  await page.getByRole('button', { name: /^Tutup sesi: Catatan$/ }).click();
  await expect(sessionTab(page, 'Catatan')).toHaveCount(0);
  await expect(sessionTab(page, 'JSON')).toBeVisible();

  // Delete pada tab yang fokus juga menutup sesi.
  await sessionTab(page, 'JSON').focus();
  await page.keyboard.press('Delete');
  await expect(sessionTab(page, 'JSON')).toHaveCount(0);
  await expect(sessionTab(page, 'Catatan')).toHaveCount(0);
});
