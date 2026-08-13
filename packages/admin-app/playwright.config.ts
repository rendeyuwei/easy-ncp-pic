import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'Pixel 7',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      command: 'node ./e2e/start-api.mjs',
      url: 'http://127.0.0.1:3001/api/health',
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      timeout: 120_000,
    },
    {
      command: 'EASYPIC_ADMIN_API_ORIGIN=http://127.0.0.1:3001 pnpm exec vite --host 127.0.0.1 --port 4175',
      url: 'http://127.0.0.1:4175/admin/',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
