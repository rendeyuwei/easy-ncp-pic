import { defineConfig } from '@playwright/test';

const shellDist = process.env.SHELL_DIST;
if (!shellDist) {
  throw new Error('Set SHELL_DIST to a built rende-site dist. This preview keeps easypic en:false.');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: 'locale.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    headless: true,
    acceptDownloads: true,
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile-320', use: { viewport: { width: 320, height: 720 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-390', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'EASYPIC_DEPLOY_PREFIX=easypic pnpm exec vite build && node scripts/serve-locale-preview.mjs',
    url: 'http://127.0.0.1:4175/easypic/',
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      WEB_DIST: 'dist',
      SHELL_DIST: shellDist,
      PORT: '4175',
    },
  },
});
