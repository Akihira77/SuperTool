import { expect, test, type Page } from './support/fixtures';
import { audit } from './support/a11y';
import { openTool, signIn } from './support/auth';
import { MARKDOWN_FIXTURE, seedFiles, seedWebhook } from './support/seed';

/**
 * Regresi audit UI data-rich: state berisi (banyak baris, nama/path panjang,
 * berkas besar, riwayat webhook, log) di viewport sempit dan lebar.
 * Data dibuat lewat API aplikasi sendiri, jadi hasil tidak bergantung host.
 */

const panel = (page: Page) => page.locator('[role="tabpanel"]:not([aria-hidden="true"])');
const WIDTHS = [
  [360, 800],
  [390, 844],
] as const;

const docOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const visibleOverflow = (page: Page) =>
  panel(page).evaluate((root) => {
    const vw = document.documentElement.clientWidth;
    const insideScroller = (node: HTMLElement) => {
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if ((style.overflowX === 'auto' || style.overflowX === 'scroll') && parent.scrollWidth > parent.clientWidth + 2) return true;
      }
      return false;
    };
    return Array.from(root.querySelectorAll<HTMLElement>('button, a, input, textarea, select'))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (rect.right <= vw + 1 && rect.left >= -1) return false;
        return !insideScroller(node);
      })
      .map((node) => `${node.tagName}[${(node.textContent ?? '').trim().slice(0, 20)}] right=${Math.round(node.getBoundingClientRect().right)}`);
  });

/** Buka tool pada lebar desktop (sidebar hanya ada >=768px) lalu kecilkan. */
async function openAt(page: Page, label: string, width: number, height: number) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTool(page, label);
  await page.setViewportSize({ width, height });
  await expect(panel(page)).toBeVisible();
}

test('E responsive: empat tool data-rich tidak melebar horizontal di 360/390', async ({ page, app }) => {
  await signIn(page, app);
  const files = await seedFiles(page.request, app.baseUrl);
  await seedWebhook(page.request, app.baseUrl);

  for (const [width, height] of WIDTHS) {
    // File Explorer: daftar banyak entri + nama panjang.
    await openAt(page, 'File Explorer', width, height);
    // Iterasi sebelumnya mungkin meninggalkan berkas terbuka di sesi yang sama.
    const backToList = panel(page).getByRole('button', { name: 'Kembali ke daftar' });
    if (await backToList.count()) await backToList.click();
    await expect(panel(page).locator('tbody tr', { hasText: files.longName })).toHaveCount(1);
    expect(await docOverflow(page), `File Explorer melebar di ${width}`).toBe(0);
    expect(await visibleOverflow(page), `kontrol terpotong di File Explorer ${width}`).toEqual([]);

    // Pratinjau Markdown: tabel lebar + baris kode panjang di dalam berkas.
    await panel(page).locator('tbody tr', { hasText: files.longName }).first().evaluate((el) => (el as HTMLElement).click());
    await panel(page).getByRole('button', { name: 'Pratinjau', exact: true }).click();
    await expect(panel(page).getByRole('region', { name: 'Isi berkas' })).toBeVisible();
    await expect(panel(page).locator('.md h1')).toHaveCount(0);
    await expect(panel(page).locator('.md h2')).toHaveText('Laporan Kinerja');
    expect(await docOverflow(page), `pratinjau berkas melebar di ${width}`).toBe(0);

    // Berkas > 2000 baris: penampil virtual harus fokusable tanpa melebarkan halaman.
    await panel(page).getByRole('button', { name: 'Kembali ke daftar' }).click();
    await panel(page).locator('tbody tr', { hasText: 'log-panjang-2500-baris' }).first().evaluate((el) => (el as HTMLElement).click());
    const code = panel(page).getByRole('region', { name: 'Isi berkas' });
    await expect(code).toBeVisible();
    expect(await code.evaluate((el) => el.tabIndex)).toBe(0);
    expect(await docOverflow(page), `berkas besar melebar di ${width}`).toBe(0);

    // Markdown: toolbar membungkus, sehingga tombol terakhir tetap terlihat.
    await openAt(page, 'Markdown', width, height);
    // Iterasi sebelumnya meninggalkan sesi dalam mode pratinjau.
    await panel(page).getByRole('button', { name: 'Editor', exact: true }).click();
    await panel(page).locator('textarea').first().fill(MARKDOWN_FIXTURE);
    const lastTool = await panel(page).getByRole('button', { name: 'Tabel' }).boundingBox();
    expect(lastTool!.x + lastTool!.width, `toolbar Markdown terpotong di ${width}`).toBeLessThanOrEqual(width);
    expect(await docOverflow(page), `Markdown melebar di ${width}`).toBe(0);

    await panel(page).getByRole('button', { name: 'Pratinjau' }).click();
    await expect(panel(page).getByRole('region', { name: 'Pratinjau Markdown' })).toBeVisible();
    await expect(panel(page).locator('h1')).toHaveCount(1);
    await expect(panel(page).locator('.md h2')).toHaveText('Dokumen Uji');
    expect(await docOverflow(page), `pratinjau Markdown melebar di ${width}`).toBe(0);

    // Webhook: daftar 15 request + detail panjang, keduanya tetap terbaca.
    await openAt(page, 'Webhook Receiver', width, height);
    await expect(panel(page).getByRole('region', { name: 'Request masuk' })).toBeVisible();
    const detail = panel(page).getByRole('region', { name: 'Detail request' });
    const detailBox = await detail.boundingBox();
    expect(detailBox!.height, `detail webhook terlalu pendek di ${width}`).toBeGreaterThan(180);
    await panel(page).locator('[role="region"] button').first().click();
    await expect(detail.getByText('/api/hook/').first()).toBeVisible();
    expect(await docOverflow(page), `Webhook melebar di ${width}`).toBe(0);

    // Setelan: kartu diagnosa + log panjang tanpa kontrol keluar viewport.
    await openAt(page, 'Setelan', width, height);
    await expect(panel(page).getByText('Error terakhir', { exact: true })).toBeVisible();
    expect(await visibleOverflow(page), `kontrol terpotong di Setelan ${width}`).toEqual([]);
    expect(await docOverflow(page), `Setelan melebar di ${width}`).toBe(0);
  }
});

test('E responsive: tooltip tidak terpotong di tepi viewport', async ({ page, app }) => {
  await signIn(page, app);
  const files = await seedFiles(page.request, app.baseUrl);
  const tip = page.locator('.tooltip');

  // Tooltip tombol paling kanan.
  await openAt(page, 'Markdown', 360, 800);
  const exportButton = panel(page).locator('[data-action="markdown:export"]');
  await exportButton.hover();
  await expect(tip).toBeVisible();
  for (const width of [360, 1440]) {
    await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
    await exportButton.hover();
    await expect(tip).toBeVisible();
    const box = (await tip.boundingBox())!;
    expect(box.x, `tooltip keluar kiri di ${width}`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `tooltip keluar kanan di ${width}`).toBeLessThanOrEqual(width);
  }

  // Tooltip tombol paling kiri di header berkas.
  await page.setViewportSize({ width: 1280, height: 800 });
  await openTool(page, 'File Explorer');
  await page.setViewportSize({ width: 360, height: 800 });
  await panel(page).locator('tbody tr', { hasText: files.longName }).first().evaluate((el) => (el as HTMLElement).click());
  await panel(page).getByRole('button', { name: 'Kembali ke daftar' }).hover();
  await expect(tip).toBeVisible();
  const box = (await tip.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
});

test('E a11y data-rich: axe pada state berisi di viewport sempit', async ({ page, app }) => {
  await signIn(page, app);
  const files = await seedFiles(page.request, app.baseUrl);
  await seedWebhook(page.request, app.baseUrl);

  await openAt(page, 'File Explorer', 360, 800);
  await audit(page, 'files-data-rich');

  await panel(page).locator('tbody tr', { hasText: files.longName }).first().evaluate((el) => (el as HTMLElement).click());
  await panel(page).getByRole('button', { name: 'Pratinjau', exact: true }).click();
  await expect(panel(page).locator('.md')).toBeVisible();
  await audit(page, 'files-preview-data-rich');

  await openAt(page, 'Markdown', 360, 800);
  await panel(page).locator('textarea').first().fill(MARKDOWN_FIXTURE);
  await audit(page, 'markdown-edit-data-rich');
  await panel(page).getByRole('button', { name: 'Pratinjau' }).click();
  await expect(panel(page).locator('.md h2')).toHaveText('Dokumen Uji');
  await audit(page, 'markdown-preview-data-rich');

  await openAt(page, 'Webhook Receiver', 360, 800);
  await panel(page).locator('[role="region"] button').first().click();
  await audit(page, 'webhook-detail-data-rich');

  await openAt(page, 'Setelan', 360, 800);
  await audit(page, 'settings-data-rich');
});

test('E i18n: nama aksesibel ikut berubah saat bahasa diganti', async ({ page, app }) => {
  await signIn(page, app);
  await openAt(page, 'Markdown', 1280, 800);
  const markdownPanel = panel(page);

  await markdownPanel.getByRole('button', { name: 'Pratinjau' }).click();
  await expect(markdownPanel.getByRole('region', { name: 'Pratinjau Markdown' })).toBeVisible();

  // Ganti bahasa lewat kontrol sidebar; tanpa reload.
  await page.getByRole('group', { name: 'Bahasa' }).getByRole('button', { name: 'EN', exact: true }).click();
  await expect(markdownPanel.getByRole('region', { name: 'Markdown preview' })).toBeVisible();
  await expect(markdownPanel.getByRole('button', { name: 'Preview' })).toBeVisible();
  await expect(markdownPanel.getByRole('region', { name: 'Pratinjau Markdown' })).toHaveCount(0);

  await page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'ID', exact: true }).click();
  await expect(markdownPanel.getByRole('region', { name: 'Pratinjau Markdown' })).toBeVisible();
});
