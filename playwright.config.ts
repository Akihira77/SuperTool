import { defineConfig, devices } from '@playwright/test';

/**
 * E2E menjalankan API produksi (yang juga menyajikan `apps/web/dist`) dengan
 * ST_DATA_DIR/ST_FS_ROOTS sementara per worker. Build harus sudah ada:
 * `pnpm e2e` melakukan build lebih dulu.
 *
 * workers: 1 karena satu instance API dipakai bersama dan run pertama mengganti
 * password awal. Test tetap tidak bergantung urutan (helper login idempoten).
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
