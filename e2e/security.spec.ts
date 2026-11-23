import { expect, test } from './support/fixtures';
import { signIn } from './support/auth';

test('E2E-05 API terlindungi menolak tanpa sesi dan tanpa CSRF', async ({ page, app, playwright }) => {
  await signIn(page, app);

  const anon = await playwright.request.newContext();
  try {
    expect((await anon.get(app.baseUrl + '/api/notes')).status()).toBe(401);
  } finally {
    await anon.dispose();
  }

  const state = await page.context().storageState();
  const noCsrf = await playwright.request.newContext({ storageState: state });
  try {
    const res = await noCsrf.post(app.baseUrl + '/api/notes', { data: { title: 'csrf', body: '' } });
    expect(res.status()).toBe(403);
  } finally {
    await noCsrf.dispose();
  }
});

test('E2E-05 login gagal menampilkan error yang dapat diakses', async ({ page, app }) => {
  await page.goto(app.baseUrl + '/');
  await page.getByLabel('Password', { exact: true }).fill('password-salah-sekali');
  await page.getByRole('button', { name: 'Masuk' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText(/password/i);
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
});

test('E2E-05 sesi tidak valid tidak menampilkan shell terautentikasi', async ({ page, app }) => {
  await signIn(page, app);

  await page.context().addCookies([
    { name: 'st_session', value: 'tidak-valid', url: app.baseUrl, httpOnly: true, sameSite: 'Lax' },
  ]);
  await page.goto(app.baseUrl + '/');

  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Keluar' })).toHaveCount(0);
});
