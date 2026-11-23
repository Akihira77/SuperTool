import { expect, test } from '@playwright/test';
import { startApp } from './support/app';
import { INITIAL_PASSWORD, TEST_PASSWORD } from './support/auth';

/**
 * Memakai instance sendiri (database sementara baru) supaya status "wajib ganti
 * password" dijamin ada, tanpa bergantung pada urutan test lain.
 */
test('E2E-01 auth: ganti password wajib, sesi bertahan, logout', async ({ page }) => {
  const app = await startApp();
  try {
    await page.goto(app.baseUrl + '/');
    await expect(page.getByRole('heading', { name: 'Super Tool' })).toBeVisible();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();

    await page.getByLabel('Password', { exact: true }).fill(INITIAL_PASSWORD);
    await page.getByRole('button', { name: 'Masuk' }).click();

    await expect(page.getByRole('heading', { name: 'Ganti password' })).toBeVisible();
    await expect(page.getByText('Wajib diganti sebelum memakai tool')).toBeVisible();

    // Gate: shell dan tool tidak boleh bisa dipakai sebelum password diganti.
    await expect(page.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Keluar' })).toHaveCount(0);

    // Validasi UI: password terlalu pendek.
    await page.getByLabel('Password lama').fill(INITIAL_PASSWORD);
    await page.getByLabel('Password baru', { exact: true }).fill('pendek');
    await page.getByLabel('Ulangi password baru').fill('pendek');
    await expect(page.getByText('Minimal 8 karakter')).toBeVisible();
    const save = page.getByRole('button', { name: 'Simpan password' });
    await expect(save).toBeDisabled();

    // Validasi UI: konfirmasi tidak sama.
    await page.getByLabel('Password baru', { exact: true }).fill(TEST_PASSWORD);
    await page.getByLabel('Ulangi password baru').fill(TEST_PASSWORD + '-beda');
    await expect(page.getByText('Belum sama dengan password baru')).toBeVisible();
    await expect(save).toBeDisabled();

    await page.getByLabel('Ulangi password baru').fill(TEST_PASSWORD);
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.getByRole('tablist').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Keluar' })).toBeVisible();

    // Sesi tetap valid setelah reload.
    await page.reload();
    await expect(page.getByRole('tablist').first()).toBeVisible();

    await page.getByRole('button', { name: 'Keluar' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
    await expect(page.getByRole('tablist')).toHaveCount(0);

    // Password baru berlaku dan tidak memaksa ganti lagi.
    await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Masuk' }).click();
    await expect(page.getByRole('tablist').first()).toBeVisible();
  } finally {
    await app.stop();
  }
});
