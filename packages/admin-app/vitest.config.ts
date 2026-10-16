import { defineConfig } from 'vitest/config';

// Filter timestamps are asserted in Asia/Shanghai. GitHub-hosted runners are UTC.
process.env.TZ = 'Asia/Shanghai';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
