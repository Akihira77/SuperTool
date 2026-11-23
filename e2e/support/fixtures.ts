import { test as base } from '@playwright/test';
import { startApp, startMockUpstream, type App, type Upstream } from './app';

type WorkerFixtures = { app: App; upstream: Upstream };

/**
 * Satu instance API produksi + satu upstream mock per worker. `workers: 1`
 * membuat seluruh suite berbagi satu database sementara, dan teardown tetap
 * berjalan walau assertion gagal.
 */
export const test = base.extend<Record<string, never>, WorkerFixtures>({
  app: [
    async ({}, use) => {
      const app = await startApp();
      try {
        await use(app);
      } finally {
        await app.stop();
      }
    },
    { scope: 'worker', auto: true },
  ],
  upstream: [
    async ({}, use) => {
      const upstream = await startMockUpstream();
      try {
        await use(upstream);
      } finally {
        await upstream.stop();
      }
    },
    { scope: 'worker', auto: true },
  ],
});

export { expect } from '@playwright/test';
