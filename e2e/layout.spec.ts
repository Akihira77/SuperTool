import { expect, test } from './support/fixtures';
import { openTool, signIn } from './support/auth';

test('layout: menu proyek tidak keluar viewport di 360px', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 360, height: 800 });

  await page.locator('[data-action="project:toggle"]').click();
  const menu = page.locator('#project-menu');
  await expect(menu).toBeVisible();

  // Regresi: menu 20rem berjangkar pada tombol yang bukan elemen paling kanan
  // (jam ada sesudahnya), sehingga x=-72 pada 360px.
  const box = await menu.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test('layout: webhook tanpa request hanya punya satu empty state', async ({ page, app }) => {
  await signIn(page, app);
  await openTool(page, 'Webhook Receiver');

  await expect(page.getByText('Belum ada request. Coba kirim dari terminal:')).toBeVisible();
  // Panel detail tidak boleh meminta memilih request yang belum ada.
  await expect(page.getByText('Pilih satu request untuk melihat header dan body.')).toHaveCount(0);
});
