import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/test/browser/');
});

test('WebGL2 stays within the Canvas reference pixel tolerance', async ({ page }) => {
  const result = await page.evaluate(() => window.easyPicHarness.runWebGLParity());

  expect(result.webgl2).toBe(true);
  expect(result.cases).toHaveLength(6);
  for (const item of result.cases) {
    expect(item.maxDelta, item.name).toBeLessThanOrEqual(3);
    expect(item.meanDelta, item.name).toBeLessThanOrEqual(0.5);
  }
});

test('WebGL creation failure reports once and uses exact Canvas output', async ({ page }) => {
  const result = await page.evaluate(() => window.easyPicHarness.runForcedFallback());

  expect(result).toEqual({ fallbackCount: 1, kind: 'canvas', exactCanvasMatch: true });
});
