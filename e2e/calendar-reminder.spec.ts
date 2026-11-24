import { expect, test, type Page } from './support/fixtures';
import { openTool, signIn } from './support/auth';

/**
 * Dropdown pengingat Calendar: popup harus cukup lebar untuk label utuh,
 * berada di atas konten, tidak terpotong, dan tetap di dalam viewport.
 * Popup memakai portal ke body, jadi locator-nya di level page.
 */

const panel = (page: Page) => page.locator('[role="tabpanel"]:not([aria-hidden="true"])');
const reminder = (page: Page, name = 'Ingatkan') => panel(page).getByRole('combobox', { name });
const listbox = (page: Page, name = 'Ingatkan') => page.getByRole('listbox', { name });

async function popupMetrics(page: Page, name = 'Ingatkan') {
  return listbox(page, name).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      position: style.position,
      zIndex: style.zIndex,
      inBody: element.parentElement === document.body,
      top: rect.top,
      left: rect.left,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
    };
  });
}

async function visibleButTruncated(page: Page, name = 'Ingatkan') {
  return listbox(page, name)
    .locator('[role="option"] > span')
    .evaluateAll((nodes) => nodes.filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent));
}

async function expectInsideViewport(page: Page, name = 'Ingatkan') {
  const m = await popupMetrics(page, name);
  expect(m.position).toBe('fixed');
  expect(m.inBody).toBe(true);
  expect(m.top).toBeGreaterThanOrEqual(0);
  expect(m.left).toBeGreaterThanOrEqual(0);
  expect(m.right).toBeLessThanOrEqual(m.vw + 0.5);
  expect(m.bottom).toBeLessThanOrEqual(m.vh + 0.5);
  return m;
}

const docOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test('Calendar: label pengingat utuh, opsi terpilih jelas, dan keyboard tetap jalan', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'Calendar');

  const combo = reminder(page);
  await expect(combo).toBeVisible();
  await combo.click();
  await expect(listbox(page)).toBeVisible();

  const metrics = await expectInsideViewport(page);
  expect(metrics.width).toBeGreaterThanOrEqual(160);
  expect(metrics.width).toBeLessThanOrEqual(220);
  expect(metrics.zIndex).toBe('90');
  expect(await visibleButTruncated(page)).toEqual([]);
  expect(await panel(page).getByRole('combobox', { name: 'Ingatkan' }).getAttribute('aria-expanded')).toBe('true');

  const selected = listbox(page).locator('[role="option"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  const initialLabel = (await combo.textContent())?.trim() ?? '';
  expect(initialLabel.length).toBeGreaterThan(0);
  await expect(selected).toHaveText(initialLabel);
  const optionLabels = (await listbox(page).getByRole('option').allTextContents()).map((text) => text.trim());
  const currentIndex = optionLabels.indexOf(initialLabel);
  expect(currentIndex).toBeGreaterThanOrEqual(0);
  const nextLabel = optionLabels[(currentIndex + 1) % optionLabels.length];

  // Popup menutupi konten kalender (stacking), bukan di bawahnya.
  expect(
    await listbox(page).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 6);
      return Boolean(target && element.contains(target));
    }),
  ).toBe(true);

  // ArrowDown → Enter memilih opsi berikutnya dan mengembalikan fokus ke trigger.
  await combo.press('ArrowDown');
  await combo.press('Enter');
  await expect(listbox(page)).toBeHidden();
  await expect(combo).toHaveAttribute('aria-expanded', 'false');
  await expect(combo).toContainText(nextLabel);
  await expect(combo).toBeFocused();

  // Kembalikan nilai awal agar state test stabil.
  await combo.click();
  await listbox(page).getByRole('option', { name: initialLabel }).click();
  await expect(listbox(page)).toBeHidden();
  await expect(combo).toContainText(initialLabel);
});

test('Calendar: Escape dan klik luar menutup popup; popup dijepit di viewport pendek', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'Calendar');

  const combo = reminder(page);
  await combo.click();
  await expect(listbox(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(listbox(page)).toBeHidden();
  await expect(combo).toBeFocused();

  await combo.click();
  await expect(listbox(page)).toBeVisible();
  await panel(page).getByRole('heading', { level: 1, name: 'Calendar' }).click();
  await expect(listbox(page)).toBeHidden();

  // Viewport pendek: popup tidak boleh melewati batas bawah.
  await page.setViewportSize({ width: 768, height: 280 });
  await combo.click();
  await expect(listbox(page)).toBeVisible();
  await expectInsideViewport(page);
});

test('Calendar: dropdown pengingat aman di 360/390/768 tanpa overflow', async ({ page, app }) => {
  await signIn(page, app);
  const widths = [
    [360, 780],
    [390, 844],
    [768, 900],
  ] as const;

  for (const [width, height] of widths) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openTool(page, 'Calendar');
    await page.setViewportSize({ width, height });

    const add = panel(page).getByRole('button', { name: /Tambah Event|Add Event/ });
    await expect(add).toBeVisible();
    const box = await add.boundingBox();
    expect(box?.right ?? 0).toBeLessThanOrEqual(width + 0.5);
    expect(await docOverflow(page)).toBe(0);

    const combo = reminder(page);
    await combo.click();
    await expect(listbox(page)).toBeVisible();
    await expectInsideViewport(page);
    expect(await visibleButTruncated(page)).toEqual([]);
    expect(await docOverflow(page)).toBe(0);

    await page.keyboard.press('Escape');
    await expect(listbox(page)).toBeHidden();
  }
});

test('Calendar: label pengingat lengkap dalam bahasa Inggris', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'Calendar');

  await page.getByRole('group', { name: 'Bahasa' }).getByRole('button', { name: 'EN' }).click();

  const combo = reminder(page, 'Remind me');
  await expect(combo).toBeVisible();
  await combo.click();
  await expect(listbox(page, 'Remind me')).toBeVisible();

  const metrics = await expectInsideViewport(page, 'Remind me');
  expect(metrics.width).toBeGreaterThanOrEqual(160);
  expect(metrics.width).toBeLessThanOrEqual(220);
  expect(await visibleButTruncated(page, 'Remind me')).toEqual([]);

  const texts = await listbox(page, 'Remind me').locator('[role="option"]').allTextContents();
  expect(texts.join(' | ')).toContain('30 minutes before');
  await expect(listbox(page, 'Remind me').locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
});

test('Select lain tetap memakai lebar trigger sebagai default', async ({ page, app }) => {
  await signIn(page, app);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTool(page, 'File Explorer');

  const combo = panel(page).getByRole('combobox', { name: 'Root berkas' });
  await expect(combo).toBeVisible();
  const trigger = await combo.boundingBox();
  await combo.click();

  const list = page.getByRole('listbox', { name: 'Root berkas' });
  await expect(list).toBeVisible();
  const popup = await list.boundingBox();
  expect(Math.abs((popup?.width ?? 0) - (trigger?.width ?? 0))).toBeLessThanOrEqual(1);

  // Pilih opsi lewat klik: popup tertutup dan fokus kembali ke trigger.
  await list.getByRole('option').first().click();
  await expect(list).toBeHidden();
  await expect(combo).toBeFocused();
});
