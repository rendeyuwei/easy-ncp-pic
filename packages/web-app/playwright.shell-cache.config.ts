import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'shell-cache.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 120_000,
  use: {
    browserName: 'chromium',
    headless: true,
  },
});
