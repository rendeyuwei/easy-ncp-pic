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

test('real module Worker loads, previews, exports, and reports progress', async ({ page }) => {
  const result = await page.evaluate(() => window.easyPicHarness.runWorkerRoundTrip());

  expect(result.loaded).toEqual({ width: 64, height: 48, sourceFormat: 'image/png' });
  expect(result.preview).toEqual({ width: 32, height: 24, changed: true });
  expect(result.exported.width).toBe(64);
  expect(result.exported.height).toBe(48);
  expect(result.exported.byteLength).toBeGreaterThan(0);
  for (const values of Object.values(result.progress)) {
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(values).toEqual([...values].sort((a, b) => a - b));
  }
});

test('forced Canvas Worker matches the direct Canvas engine exactly', async ({ page }) => {
  const result = await page.evaluate(() => window.easyPicHarness.runCanvasWorkerParity());

  expect(result).toEqual({ width: 8, height: 6, exactCanvasMatch: true });
});
