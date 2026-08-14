import { expect, test, type Page, type Request } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const lut257 = Array.from({ length: 257 }, (_, index) => index / 256);
const publicFilters = {
  categories: [
    {
      id: 'category-film',
      name: '胶片',
      slug: 'film',
      sortOrder: 10,
      filters: [
        {
          id: 'filter-astia',
          slug: 'fuji-astia',
          displayName: 'Fuji Astia',
          sourceName: 'Fuji Astia',
          description: '柔和的人像色彩',
          parserVersion: 1,
          parsed: {
            schemaVersion: 1,
            sourceFormat: 'ncp',
            sourceVersion: 100,
            sourceName: 'Fuji Astia',
            basePictureControl: { code: 2, name: 'Neutral' },
            sharpening: 2,
            saturation: 1,
            hue: 0,
            monochromeFilter: null,
            toningType: null,
            toningStrength: null,
            customCurve: {
              enabled: true,
              gamma: 1,
              controlPoints: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
              lut257,
            },
            supported: true,
            warnings: [],
          },
        },
      ],
    },
  ],
};

const rapidFilters = {
  ...publicFilters,
  categories: [{
    ...publicFilters.categories[0],
    filters: ['A', 'B', 'C'].map((name) => ({
      ...publicFilters.categories[0].filters[0],
      id: `filter-${name.toLowerCase()}`,
      slug: `filter-${name.toLowerCase()}`,
      displayName: `Filter ${name}`,
      sourceName: `Filter ${name}`,
      parsed: {
        ...publicFilters.categories[0].filters[0].parsed,
        sourceName: `Filter ${name}`,
      },
    })),
  }],
};

async function installApi(
  page: Page,
  requests: Request[],
  status = 200,
  filters = publicFilters,
): Promise<void> {
  page.on('request', (request) => requests.push(request));
  await page.route('**/api/filters', async (route) => {
    if (status !== 200) {
      await route.fulfill({ status, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(filters),
    });
  });
}

async function delayWorkerMessages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Keep the production Worker and renderer, but hold its replies long enough to
    // exercise the user interaction that occurs while the preview is pending.
    const NativeWorker = window.Worker;
    const listenerMap = new WeakMap<Worker, Map<EventListenerOrEventListenerObject, EventListener>>();

    window.Worker = class DelayedWorker extends NativeWorker {
      addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        if (type !== 'message') {
          super.addEventListener(type, listener, options);
          return;
        }
        const delayed = (event: Event): void => {
          window.setTimeout(() => {
            if (typeof listener === 'function') listener.call(this, event);
            else listener.handleEvent(event);
          }, 100);
        };
        const listeners = listenerMap.get(this) ?? new Map();
        listeners.set(listener, delayed);
        listenerMap.set(this, listeners);
        super.addEventListener(type, delayed, options);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
        const delayed = listenerMap.get(this)?.get(listener);
        super.removeEventListener(type, delayed ?? listener, options);
      }
    };
  });
}

async function openEditor(page: Page, file = 'photo.png'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('选择一张照片').setInputFiles(`e2e/fixtures/${file}`);
  await expect(page.getByRole('heading', { name: '选择一个滤镜' })).toBeVisible();
}

test.describe('EasyPic local editor', () => {
  test('uploads PNG, edits locally and downloads original dimensions', async ({ page }) => {
    const requests: Request[] = [];
    await installApi(page, requests);
    await delayWorkerMessages(page);
    await openEditor(page);

    await page.getByRole('button', { name: /Fuji Astia/ }).click();
    await expect(page.getByRole('status').filter({ hasText: '正在应用 Fuji Astia' }))
      .toContainText('正在应用 Fuji Astia');

    const intensity = page.getByRole('slider', { name: '滤镜强度' });
    await intensity.press('ArrowLeft');
    await expect(page.getByRole('heading', { name: 'Fuji Astia' })).toBeVisible();
    await expect(page.getByText('99%')).toBeVisible();
    await expect(page.getByLabel('Fuji Astia 滤镜预览')).toBeVisible();

    const compare = page.getByTestId('compare-surface');
    const box = await compare.boundingBox();
    if (!box) throw new Error('Comparison surface has no bounds');
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.mouse.up();
    await expect(page.getByRole('slider', { name: '原图与滤镜对比' })).toHaveAttribute('aria-valuenow', '75');

    await page.getByRole('button', { name: '导出' }).click();
    await expect(page.getByRole('radio', { name: 'PNG' })).toBeChecked();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出照片' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('photo-easypic.png');
    const path = await download.path();
    if (!path) throw new Error('Download has no local path');
    const bytes = Array.from(await readFile(path));
    const dimensions = await page.evaluate(async (encoded) => {
      const blob = new Blob([Uint8Array.from(encoded)], { type: 'image/png' });
      const bitmap = await createImageBitmap(blob);
      return { width: bitmap.width, height: bitmap.height };
    }, bytes);
    expect(dimensions).toEqual({ width: 64, height: 48 });

    expect(requests.filter((request) => request.url().includes('/api/filters')).length).toBeGreaterThan(0);
    expect(requests.some((request) => request.url().includes('photo.png'))).toBe(false);
    expect(requests.some((request) => request.postData()?.includes('photo.png'))).toBe(false);
  });

  test('coalesces rapid filter selections so only the latest filter commits', async ({ page }) => {
    await installApi(page, [], 200, rapidFilters);
    await delayWorkerMessages(page);
    await openEditor(page);

    const filterA = page.getByRole('button', { name: /Filter A/ });
    const filterB = page.getByRole('button', { name: /Filter B/ });
    const filterC = page.getByRole('button', { name: /Filter C/ });
    await filterA.click();
    await expect(page.getByRole('status').filter({ hasText: '正在应用 Filter A' }))
      .toContainText('正在应用 Filter A');
    await filterB.click();
    await filterC.click();

    await expect(page.getByRole('heading', { name: 'Filter C' })).toBeVisible();
    await expect(filterA).toHaveAttribute('aria-pressed', 'false');
    await expect(filterB).toHaveAttribute('aria-pressed', 'false');
    await expect(filterC).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status').filter({ hasText: /正在/ })).toHaveCount(0);
  });

  test('JPEG export defaults to JPG quality 92%', async ({ page }) => {
    await installApi(page, []);
    await openEditor(page, 'photo.jpg');
    await page.getByRole('button', { name: /Fuji Astia/ }).click();
    await expect(page.getByRole('heading', { name: 'Fuji Astia' })).toBeVisible();

    await page.getByRole('button', { name: '导出' }).click();

    await expect(page.getByRole('radio', { name: 'JPG' })).toBeChecked();
    await expect(page.getByText('质量 92%')).toBeVisible();
  });

  test('layout, theme persistence and reduced motion match the viewport', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await installApi(page, []);
    await openEditor(page);
    await page.getByRole('button', { name: /Fuji Astia/ }).click();
    await expect(page.getByRole('heading', { name: 'Fuji Astia' })).toBeVisible();

    const preview = page.locator('.preview-panel');
    const filters = page.locator('.filter-rail');
    const previewBox = await preview.boundingBox();
    const filtersBox = await filters.boundingBox();
    const photoBox = await page.locator('.photo-compare').boundingBox();
    if (!previewBox || !filtersBox || !photoBox) throw new Error('Editor regions have no bounds');
    expect(Math.abs(photoBox.width / photoBox.height - 64 / 48)).toBeLessThan(0.01);
    if (testInfo.project.name === 'desktop') {
      expect(filtersBox.x).toBeGreaterThan(previewBox.x + previewBox.width - 2);
    } else {
      expect(filtersBox.y).toBeGreaterThan(previewBox.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => document.documentElement.clientWidth),
      );
    }

    const transitionDurations = await page.locator('.button').first().evaluate(
      (element) => getComputedStyle(element).transitionDuration.split(',').map((value) => Number.parseFloat(value)),
    );
    expect(transitionDurations.every((duration) => duration <= 0.00001)).toBe(true);

    await page.getByRole('button', { name: '切换到浅色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('API failure keeps local upload available', async ({ page }) => {
    await installApi(page, [], 503);
    await page.goto('/');

    await expect(page.getByText('滤镜暂时无法加载，请稍后重试。')).toBeVisible();
    await expect(page.getByRole('button', { name: '上传照片' })).toBeVisible();
    await expect(page.getByLabel('选择一张照片')).toBeEnabled();
  });
});
