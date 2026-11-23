import { expect, type Page } from '@playwright/test';
import type { App } from './app';

export const INITIAL_PASSWORD = 'password';
export const TEST_PASSWORD = 'e2e-password-123';

type LoginState = 'error' | 'change' | 'ready';

async function submitLogin(page: Page, password: string): Promise<void> {
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk' }).click();
}

/** Tunggu salah satu penanda hasil login muncul, lalu klasifikasikan. */
async function loginState(page: Page): Promise<LoginState> {
  const marker = page.locator('[role="tablist"], #cp-current, [role="alert"]').first();
  await marker.waitFor({ state: 'visible', timeout: 15_000 });
  return marker.evaluate((element) => {
    if (element.id === 'cp-current') return 'change';
    if (element.getAttribute('role') === 'alert') return 'error';
    return 'ready';
  });
}

export async function changePassword(page: Page, current: string): Promise<void> {
  await page.getByLabel('Password lama').fill(current);
  await page.getByLabel('Password baru', { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel('Ulangi password baru').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'Simpan password' }).click();
  await expect(page.getByRole('tablist').first()).toBeVisible();
}

/**
 * Login lewat UI. Idempoten: run pertama memakai password awal lalu mengganti
 * password, run berikutnya memakai password test. Tidak bergantung urutan test.
 */
export async function signIn(page: Page, app: App): Promise<'changed' | 'existing'> {
  await page.goto(app.baseUrl + '/');
  await expect(page.getByRole('heading', { name: 'Super Tool' })).toBeVisible();

  await submitLogin(page, TEST_PASSWORD);
  let state = await loginState(page);

  if (state === 'error') {
    await submitLogin(page, INITIAL_PASSWORD);
    state = await loginState(page);
    if (state !== 'change') throw new Error('Login password awal tidak masuk ke halaman ganti password');
    await changePassword(page, INITIAL_PASSWORD);
    return 'changed';
  }
  if (state === 'change') {
    await changePassword(page, TEST_PASSWORD);
    return 'changed';
  }
  return 'existing';
}

/** Buka tool dari sidebar (nama aksesibel = label tool). */
export async function openTool(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation').getByRole('button', { name: label, exact: true }).click();
  await expect(sessionTab(page, label)).toHaveAttribute('aria-selected', 'true');
}

/** Tab sesi tingkat aplikasi (bukan tab internal tool). */
export function sessionTab(page: Page, label: string) {
  return page.getByRole('tablist', { name: 'Sesi Super Tool' }).getByRole('tab', { name: label, exact: true });
}
