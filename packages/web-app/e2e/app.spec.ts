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
    filters: ['A', 'B', 'C'].map((name, index) => ({
      ...publicFilters.categories[0].filters[0],
      id: `filter-${name.toLowerCase()}`,
      slug: `filter-${name.toLowerCase()}`,
      displayName: `Filter ${name}`,
      sourceName: `Filter ${name}`,
      parsed: {
        ...publicFilters.categories[0].filters[0].parsed,
        sourceName: `Filter ${name}`,
        saturation: (index + 1) * 11,
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

interface PreviewRequestRecord {
  readonly id: number;
  readonly saturation: number;
  readonly intensity: number;
}

interface WorkerGateSnapshot {
  readonly heldResponseId: number | null;
  readonly previewRequests: ReadonlyArray<PreviewRequestRecord>;
  readonly committedHeadings: ReadonlyArray<string>;
}

interface WorkerGate {
  armHoldNextPreview(): void;
  releaseHeldPreview(): void;
  observeCommittedHeadings(): void;
  snapshot(): WorkerGateSnapshot;
}

async function installWorkerPreviewGate(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let armed = false;
    let heldRequestId: number | null = null;
    let heldWorker: Worker | null = null;
    let heldResponse: {
      listener: EventListenerOrEventListenerObject;
      target: Worker;
      event: Event;
    } | null = null;
    const previewRequests: PreviewRequestRecord[] = [];
    const committedHeadings: string[] = [];

    function deliver(listener: EventListenerOrEventListenerObject, target: EventTarget, event: Event): void {
      if (typeof listener === 'function') listener.call(target, event);
      else listener.handleEvent(event);
    }

    window.Worker = class GatedWorker extends NativeWorker {
      private readonly listeners = new Map<EventListenerOrEventListenerObject, EventListener>();

      addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void {
        if (type !== 'message') {
          super.addEventListener(type, listener, options);
          return;
        }
        if (this.listeners.has(listener)) return;
        const forward = (event: Event): void => {
          const data = (event as MessageEvent<{ id?: number; event?: string }>).data;
          if (this === heldWorker && data.id === heldRequestId && data.event === undefined && heldResponse === null) {
            heldResponse = { listener, target: this, event };
            return;
          }
          deliver(listener, this, event);
        };
        this.listeners.set(listener, forward);
        super.addEventListener(type, forward, options);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void {
        if (type !== 'message') {
          super.removeEventListener(type, listener, options);
          return;
        }
        const forward = this.listeners.get(listener);
        if (forward) {
          super.removeEventListener(type, forward, options);
          this.listeners.delete(listener);
          if (heldResponse?.listener === listener && heldResponse.target === this) heldResponse = null;
          return;
        }
        super.removeEventListener(type, listener, options);
      }

      postMessage(message: any, transfer: Transferable[]): void;
      postMessage(message: any, options?: StructuredSerializeOptions): void;
      postMessage(message: any, options?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as {
          id?: number;
          method?: string;
          params?: { saturation?: number };
          intensity?: number;
        };
        if (request.method === 'preview' && typeof request.id === 'number') {
          previewRequests.push({
            id: request.id,
            saturation: request.params?.saturation ?? Number.NaN,
            intensity: request.intensity ?? Number.NaN,
          });
          if (armed && heldRequestId === null) {
            armed = false;
            heldRequestId = request.id;
            heldWorker = this;
          }
        }
        if (Array.isArray(options)) super.postMessage(message, options);
        else super.postMessage(message, options);
      }

      terminate(): void {
        this.listeners.clear();
        if (heldResponse?.target === this) heldResponse = null;
        if (heldWorker === this) heldWorker = null;
        super.terminate();
      }
    };

    (window as unknown as { __easypicWorkerGate: WorkerGate }).__easypicWorkerGate = {
      armHoldNextPreview() {
        armed = true;
        heldRequestId = null;
        heldWorker = null;
        heldResponse = null;
        previewRequests.length = 0;
        committedHeadings.length = 0;
      },
      releaseHeldPreview() {
        const response = heldResponse;
        heldResponse = null;
        heldRequestId = null;
        heldWorker = null;
        if (response) deliver(response.listener, response.target, response.event);
      },
      observeCommittedHeadings() {
        const heading = document.getElementById('active-filter-title');
        if (!heading) throw new Error('Active filter heading is unavailable');
        const record = (): void => {
          committedHeadings.push(heading.textContent ?? '');
        };
        record();
        new MutationObserver(record).observe(heading, { childList: true, characterData: true, subtree: true });
      },
      snapshot() {
        return {
          heldResponseId: heldResponse ? heldRequestId : null,
          previewRequests: [...previewRequests],
          committedHeadings: [...committedHeadings],
        };
      },
    };
  });
}

async function armWorkerPreviewGate(page: Page, observeHeadings = false): Promise<void> {
  await page.evaluate((shouldObserve) => {
    const gate = (window as unknown as { __easypicWorkerGate: WorkerGate }).__easypicWorkerGate;
    gate.armHoldNextPreview();
    if (shouldObserve) gate.observeCommittedHeadings();
  }, observeHeadings);
}

async function workerGateSnapshot(page: Page): Promise<WorkerGateSnapshot> {
  return page.evaluate(() => (
    window as unknown as { __easypicWorkerGate: WorkerGate }
  ).__easypicWorkerGate.snapshot());
}

async function releaseHeldWorkerPreview(page: Page): Promise<void> {
  await page.evaluate(() => (
    window as unknown as { __easypicWorkerGate: WorkerGate }
  ).__easypicWorkerGate.releaseHeldPreview());
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
    await installWorkerPreviewGate(page);
    await openEditor(page);
    await armWorkerPreviewGate(page);

    await page.getByRole('button', { name: /Fuji Astia/ }).click();
    await expect(page.getByRole('status').filter({ hasText: '正在应用 Fuji Astia' }))
      .toContainText('正在应用 Fuji Astia');
    await expect.poll(() => workerGateSnapshot(page).then(({ heldResponseId }) => heldResponseId)).not.toBeNull();

    const intensity = page.getByRole('slider', { name: '滤镜强度' });
    await intensity.press('ArrowLeft');
    await expect(page.getByRole('heading', { name: '选择一个滤镜' })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '正在应用 Fuji Astia' }))
      .toContainText('正在应用 Fuji Astia');
    await releaseHeldWorkerPreview(page);
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
    await installWorkerPreviewGate(page);
    await openEditor(page);
    await armWorkerPreviewGate(page, true);

    const filterA = page.getByRole('button', { name: /Filter A/ });
    const filterB = page.getByRole('button', { name: /Filter B/ });
    const filterC = page.getByRole('button', { name: /Filter C/ });
    await filterA.click();
    await expect(page.getByRole('status').filter({ hasText: '正在应用 Filter A' }))
      .toContainText('正在应用 Filter A');
    await expect.poll(() => workerGateSnapshot(page).then(({ heldResponseId }) => heldResponseId)).not.toBeNull();
    await filterB.click();
    await filterC.click();
    await releaseHeldWorkerPreview(page);

    await expect(page.getByRole('heading', { name: 'Filter C' })).toBeVisible();
    await expect(filterA).toHaveAttribute('aria-pressed', 'false');
    await expect(filterB).toHaveAttribute('aria-pressed', 'false');
    await expect(filterC).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status').filter({ hasText: /正在/ })).toHaveCount(0);
    await expect.poll(() => workerGateSnapshot(page).then(({ previewRequests }) => previewRequests))
      .toEqual([
        expect.objectContaining({ saturation: 11, intensity: 1 }),
        expect.objectContaining({ saturation: 33, intensity: 1 }),
      ]);
    const committedHeadings = (await workerGateSnapshot(page)).committedHeadings;
    expect(committedHeadings).toContain('选择一个滤镜');
    expect(committedHeadings).toContain('Filter C');
    expect(committedHeadings.every((heading) => heading === '选择一个滤镜' || heading === 'Filter C')).toBe(true);
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
