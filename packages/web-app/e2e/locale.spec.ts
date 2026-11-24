import { expect, test, type Page, type Request } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';

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
          id: 'filter-soft',
          slug: 'soft',
          displayName: '柔光',
          sourceName: '柔光',
          description: '柔和的人像色彩',
          parserVersion: 1,
          parsed: {
            schemaVersion: 1,
            sourceFormat: 'ncp',
            sourceVersion: 100,
            sourceName: '柔光',
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
        {
          id: 'filter-astia',
          slug: 'astia',
          displayName: 'ASTIA',
          sourceName: 'ASTIA',
          description: '胶片人像色彩',
          parserVersion: 1,
          parsed: {
            schemaVersion: 1,
            sourceFormat: 'ncp',
            sourceVersion: 100,
            sourceName: 'ASTIA',
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

async function installApi(page: Page, requests: Request[]): Promise<void> {
  page.on('request', (request) => requests.push(request));
  await page.route('**/api/filters', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(publicFilters),
    });
  });
}

async function setLanguages(page: Page, languages: readonly string[]): Promise<void> {
  await page.addInitScript((tags) => {
    Object.defineProperty(navigator, 'languages', { configurable: true, get: () => tags });
    Object.defineProperty(navigator, 'language', { configurable: true, get: () => tags[0] ?? '' });
  }, languages);
}

async function blockStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    Object.defineProperty(Document.prototype, 'cookie', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
      set() {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
  });
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const box = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(box.scroll).toBeLessThanOrEqual(box.client + 1);
}

async function saveShot(page: Page, name: string): Promise<void> {
  await mkdir('/opt/cursor/artifacts', { recursive: true });
  await page.screenshot({ path: `/opt/cursor/artifacts/${name}.png` });
}

test.beforeEach(async ({ page }) => {
  await page.route('**://hm.baidu.com/**', (route) => route.abort());
});

test.describe('production language entries', () => {
  test('serves raw Chinese and English HTML without executing JavaScript', async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop');
    const zh = await request.get('/easypic/');
    const en = await request.get('/easypic/en/');
    const enBare = await request.get('/easypic/en');
    const zhHtml = await zh.text();
    const enHtml = await en.text();

    expect(zh.ok()).toBeTruthy();
    expect(en.ok()).toBeTruthy();
    expect(enBare.ok()).toBeTruthy();
    expect(zhHtml).toContain('lang="zh-CN"');
    expect(zhHtml).toContain('EasyPic — 在浏览器中为照片应用精选滤镜。');
    expect(zhHtml).toContain('href="https://rende.fun/easypic/"');
    expect(zhHtml).toContain('hreflang="x-default" href="https://rende.fun/easypic/en/"');
    expect(zhHtml).toContain('name="rf-mount" content="/easypic/"');
    expect(zhHtml).toContain('data-tool="easypic"');
    expect(zhHtml).toContain('src="/shell/lang.3effebca35bf58244e77657ead34de9f6afb4416ffdc3ba5a0bbcd4f2933c70d.js"');
    expect(zhHtml).toContain('src="/shell/topbar.4a304e017601ad56e80a5c39886c186fa462161ce585d093ae92c4cfc17edd7b.js"');
    expect(zhHtml).not.toContain('src="/shell/lang.js"');
    expect(zhHtml).not.toContain('src="/shell/topbar.js"');
    expect(enHtml).toContain('src="/shell/topbar.4a304e017601ad56e80a5c39886c186fa462161ce585d093ae92c4cfc17edd7b.js"');
    expect(enHtml).not.toContain('src="/shell/topbar.js"');
    expect(zhHtml).not.toContain('preview curated filters');
    expect(enHtml).toContain('lang="en"');
    expect(enHtml).toContain('EasyPic — preview curated filters on a photo in your browser.');
    expect(enHtml).toContain('name="rf-mount" content="/easypic/"');
    expect(enHtml).toContain('data-tool="easypic"');
    expect(enHtml).toContain('rel="canonical" href="https://rende.fun/easypic/en/"');
    expect(enHtml).toContain('src="/easypic/assets/');
    expect(enHtml).not.toContain('/easypic/en/assets/');
    expect(enHtml).not.toContain('精选滤镜');
    expect(await enBare.text()).toContain('lang="en"');
  });

  test('follows ordered languages, manual choice, explicit URLs, and blocked storage', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop');

    await setLanguages(page, ['fr-FR', 'zh-HK', 'en-US']);
    await page.goto('/easypic/?album=1#panel');
    await expect(page).toHaveURL(/\/easypic\/\?album=1#panel/);
    await expect(page.getByRole('heading', { name: '让照片呈现你想要的质感' })).toBeVisible();
    await expect(page.getByRole('button', { name: '工具' })).toBeVisible();

    await page.goto('/easypic/en/?lang=zh#stay');
    await expect(page).toHaveURL(/\/easypic\/en\/\?lang=zh#stay/);
    await expect(page.getByRole('heading', { name: 'Give the photo the look you want' })).toBeVisible();
    const second = page.waitForEvent('framenavigated', { timeout: 800 }).then(() => true, () => false);
    expect(await second).toBe(false);

    await setLanguages(page, ['fr', 'de']);
    await page.goto('/easypic/?album=1#panel');
    await expect(page).toHaveURL(/\/easypic\/en\/\?album=1#panel/);
    await expect(page.getByRole('link', { name: '中文' })).toBeVisible();
    await page.getByRole('link', { name: '中文' }).click();
    await expect(page).toHaveURL(/\/easypic\/\?album=1&lang=zh#panel/);
    await expect(page.getByRole('heading', { name: '让照片呈现你想要的质感' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('rf-lang'))).toBe('zh');

    await page.goto('/easypic/#again');
    await expect(page).toHaveURL(/\/easypic\/#again$/);

    await page.evaluate(() => localStorage.setItem('rf-lang', 'en'));
    await page.goto('/easypic/?album=2#kept');
    await expect(page).toHaveURL(/\/easypic\/en\/\?album=2#kept/);

    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await blockStorage(page);
    await setLanguages(page, ['en-US', 'zh-CN']);
    await page.goto('/easypic/en/#direct');
    await expect(page).toHaveURL(/\/easypic\/en\/#direct/);
    await page.getByRole('button', { name: 'Tools' }).click();
    await expect(page.locator('.rf-menu a').first()).toHaveAttribute('href', '/easypic/en/');
    await page.evaluate(() => { (window as Window & { __easypicDoc?: number }).__easypicDoc = 1; });
    await page.getByRole('link', { name: '中文' }).click();
    await expect(page).toHaveURL(/\/easypic\/\?lang=zh#direct/);
    await expect(page.getByRole('heading', { name: '让照片呈现你想要的质感' })).toBeVisible();
    expect(await page.evaluate(() => (window as Window & { __easypicDoc?: number }).__easypicDoc)).toBe(1);
    await page.getByRole('button', { name: '工具' }).click();
    const toolHrefs = await page.locator('.rf-menu a').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(toolHrefs).toEqual(['/easypic/?lang=zh', '/shutter/?lang=zh', '/recipes/?lang=zh', '/?lang=zh']);
    await page.goto('/easypic/?lang=zh#held');
    await expect(page).toHaveURL(/\/easypic\/\?lang=zh#held/);
    await expect(page.getByRole('heading', { name: '让照片呈现你想要的质感' })).toBeVisible();
  });
});

async function openEditor(page: Page, english: boolean, file: 'photo.png' | 'photo.jpg'): Promise<void> {
  await setLanguages(page, english ? ['en-US'] : ['zh-CN', 'en-US']);
  await page.goto(english ? '/easypic/en/' : '/easypic/?lang=zh');
  await expect(page.getByRole('heading', {
    name: english ? 'Give the photo the look you want' : '让照片呈现你想要的质感',
  })).toBeVisible();
  await noHorizontalOverflow(page);
  await page.getByLabel(english ? 'Choose a photo' : '选择一张照片').setInputFiles(`e2e/fixtures/${file}`);
  await expect(page.getByRole('heading', { name: english ? 'Choose a filter' : '选择一个滤镜' })).toBeVisible();
  await expect(page.getByText('柔光')).toBeVisible();
  await expect(page.getByText('柔和的人像色彩')).toBeVisible();
  await noHorizontalOverflow(page);
}

test('keeps the photo and edits across topbar language changes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const requests: Request[] = [];
  await installApi(page, requests);
  await setLanguages(page, ['zh-CN', 'en-US']);
  await page.addInitScript(() => {
    const counts = { click: 0, keydown: 0, hashchange: 0, popstate: 0 };
    const doc = Document.prototype.addEventListener;
    const win = Window.prototype.addEventListener;
    Document.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'click' || type === 'keydown') counts[type as 'click' | 'keydown'] += 1;
      return doc.call(this, type, listener, options);
    };
    Window.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'hashchange' || type === 'popstate') counts[type] += 1;
      return win.call(this, type, listener, options);
    };
    (window as Window & { __listenerAdds?: typeof counts }).__listenerAdds = counts;
  });
  await page.goto('/easypic/?album=1#panel');
  await expect(page.getByRole('heading', { name: '让照片呈现你想要的质感' })).toBeVisible();
  await page.evaluate(() => { (window as Window & { __easypicDoc?: number }).__easypicDoc = 1; });
  await page.getByLabel('选择一张照片').setInputFiles('e2e/fixtures/photo.png');
  await expect(page.getByRole('heading', { name: '选择一个滤镜' })).toBeVisible();
  await page.getByRole('button', { name: /ASTIA/ }).click();
  await expect(page.getByRole('heading', { name: 'ASTIA' })).toBeVisible();
  const strength = page.getByRole('slider', { name: '滤镜强度' });
  await strength.focus();
  await strength.press('ArrowLeft');
  await strength.press('ArrowLeft');
  await strength.press('ArrowLeft');
  await expect(page.getByText('97%')).toBeVisible();
  const compare = page.getByRole('slider', { name: '原图与滤镜对比' });
  await compare.focus();
  await compare.press('ArrowLeft');
  await compare.press('ArrowLeft');
  await expect(compare).toHaveAttribute('aria-valuenow', '46');
  await page.getByRole('button', { name: '导出' }).click();
  const firstDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出照片' }).click();
  const before = await firstDownload;
  expect(before.suggestedFilename()).toBe('photo-easypic.png');
  const beforePath = await before.path();
  if (!beforePath) throw new Error('Download has no local path');
  const beforeBytes = await readFile(beforePath);

  const decode = async (bytes: Buffer) => page.evaluate(async (encoded: number[]) => {
    const blob = new Blob([Uint8Array.from(encoded)], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('missing canvas');
    context.drawImage(bitmap, 0, 0);
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels: Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data),
    };
  }, Array.from(bytes));
  const beforeImage = await decode(beforeBytes);

  const shellRequests = () => requests.filter((request) => request.url().includes('/shell/')).length;
  const shellBefore = shellRequests();
  const listenersBefore = await page.evaluate(() => {
    const counts = (window as Window & { __listenerAdds?: { click: number; keydown: number; hashchange: number; popstate: number } }).__listenerAdds;
    return counts ? { ...counts } : null;
  });
  await page.evaluate(() => {
    const rf = window.rfLang as (Window['rfLang'] & { href?: unknown; place?: unknown }) | undefined;
    const host = window as Window & {
      __bar?: Element | null;
      __rfFns?: { choose: unknown; href: unknown; place: unknown; enter: unknown; v: number };
    };
    host.__bar = document.querySelector('.rf-bar');
    if (!rf) return;
    host.__rfFns = { choose: rf.choose, href: rf.href, place: rf.place, enter: rf.enter, v: rf.v };
  });
  const historyBefore = await page.evaluate(() => history.length);
  await page.context().setOffline(true);
  try {
    for (let step = 0; step < 5; step += 1) {
      const toggle = page.locator('a.rf-lang');
      if (step % 2 === 0) await toggle.click();
      else {
        await toggle.focus();
        await page.keyboard.press('Enter');
      }
      const english = step % 2 === 0;
      await expect(page).toHaveURL(english
        ? /\/easypic\/en\/\?album=1#panel$/
        : /\/easypic\/\?album=1&lang=zh#panel$/);
      await expect(page.locator('a.rf-lang')).toBeFocused();
      await expect(page.getByRole('button', { name: english ? 'Tools' : '工具' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'ASTIA' })).toBeVisible();
      await expect(page.getByText('97%')).toBeVisible();
      const slider = page.getByRole('slider', { name: english ? 'Compare original and filter' : '原图与滤镜对比' });
      await expect(slider).toHaveAttribute('aria-valuenow', '46');
    }
  } finally {
    await page.context().setOffline(false);
  }
  expect(await page.evaluate(() => history.length)).toBe(historyBefore + 5);
  expect(await page.evaluate(() => (window as Window & { __easypicDoc?: number }).__easypicDoc)).toBe(1);
  expect(shellRequests()).toBe(shellBefore);
  expect(await page.evaluate(() => {
    const counts = (window as Window & { __listenerAdds?: { click: number; keydown: number; hashchange: number; popstate: number } }).__listenerAdds;
    return counts ? { ...counts } : null;
  })).toEqual(listenersBefore);
  expect(await page.evaluate(() => {
    const host = window as Window & {
      __bar?: Element | null;
      __rfFns?: { choose: unknown; href: unknown; place: unknown; enter: unknown; v: number };
    };
    const rf = window.rfLang as (Window['rfLang'] & { href?: unknown; place?: unknown }) | undefined;
    return Boolean(host.__bar)
      && document.querySelector('.rf-bar') === host.__bar
      && rf?.v !== undefined
      && rf.v >= 2
      && rf.choose === host.__rfFns?.choose
      && rf.href === host.__rfFns?.href
      && rf.place === host.__rfFns?.place
      && rf.enter === host.__rfFns?.enter;
  })).toBe(true);
  await expect(page.locator('#compare-keys')).toHaveText('Use the arrow keys to move the divider. Home and End jump to either end.');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://rende.fun/easypic/en/');
  await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute('href', 'https://rende.fun/easypic/en/');
  expect(await page.evaluate(() => localStorage.getItem('rf-lang'))).toBe('en');
  const englishBody = await page.locator('body').innerText();
  expect(englishBody).not.toContain('滤镜强度');
  expect(englishBody).toContain('ASTIA');

  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByRole('dialog', { name: 'Export photo' })).toBeVisible();
  await saveShot(page, 'desktop-en-export');
  const secondDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export photo' }).click();
  const after = await secondDownload;
  expect(after.suggestedFilename()).toBe('photo-easypic.png');
  const afterPath = await after.path();
  if (!afterPath) throw new Error('Download has no local path');
  expect(await decode(await readFile(afterPath))).toEqual(beforeImage);
  expect(requests.some((request) => request.url().includes('/easypic/en/api/'))).toBe(false);
  expect(requests.some((request) => request.postData()?.includes('photo'))).toBe(false);
  await saveShot(page, 'desktop-en-retained');

  await page.goBack();
  await expect(page).toHaveURL(/\/easypic\/\?album=1&lang=zh#panel$/);
  await expect(page.getByRole('button', { name: '工具' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ASTIA' })).toBeVisible();
  await expect(page.getByText('97%')).toBeVisible();
  await expect(page.getByRole('slider', { name: '原图与滤镜对比' })).toHaveAttribute('aria-valuenow', '46');
  expect(await page.evaluate(() => (window as Window & { __easypicDoc?: number }).__easypicDoc)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('rf-lang'))).toBe('en');
  expect(shellRequests()).toBe(shellBefore);

  await page.goForward();
  await expect(page).toHaveURL(/\/easypic\/en\/\?album=1#panel$/);
  await expect(page.getByRole('button', { name: 'Tools' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ASTIA' })).toBeVisible();
  await expect(page.getByText('97%')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Compare original and filter' })).toHaveAttribute('aria-valuenow', '46');
  expect(await page.evaluate(() => (window as Window & { __easypicDoc?: number }).__easypicDoc)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('rf-lang'))).toBe('en');
  expect(shellRequests()).toBe(shellBefore);

  await page.goto('/easypic/en/#error');
  await page.getByLabel('Choose a photo').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a photo'),
  });
  await expect(page.getByRole('alert')).toHaveText('Choose a JPG or PNG photo.');
  await saveShot(page, 'desktop-en-error');
});

test.describe('both locales can edit and do not overflow', () => {
  test('edits and exports a Chinese page', async ({ page }, testInfo) => {
    const requests: Request[] = [];
    await installApi(page, requests);
    await openEditor(page, false, 'photo.png');
    if (testInfo.project.name === 'desktop') await saveShot(page, 'desktop-zh');
    if (testInfo.project.name === 'mobile-390') await saveShot(page, 'mobile-zh');
    if (testInfo.project.name !== 'desktop') return;
    await page.getByRole('button', { name: /柔光/ }).click();
    await expect(page.getByRole('heading', { name: '柔光' })).toBeVisible();
    await page.getByRole('button', { name: '导出' }).click();
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
    expect(requests.some((request) => request.url().includes('/easypic/api/filters'))).toBe(true);
    expect(requests.some((request) => request.url().includes('/easypic/en/'))).toBe(false);
  });

  test('edits and exports an English page, including JPEG quality', async ({ page }, testInfo) => {
    const requests: Request[] = [];
    await installApi(page, requests);
    await openEditor(page, true, testInfo.project.name === 'desktop' ? 'photo.jpg' : 'photo.png');
    await expect(page.getByRole('button', { name: 'Tools' })).toBeVisible();
    if (testInfo.project.name === 'desktop') await saveShot(page, 'desktop-en');
    if (testInfo.project.name === 'mobile-390') await saveShot(page, 'mobile-en');
    if (testInfo.project.name === 'mobile-320') return;

    await page.getByRole('button', { name: /柔光/ }).click();
    await expect(page.getByRole('heading', { name: '柔光' })).toBeVisible();
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('dialog', { name: 'Export photo' })).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body).not.toContain('滤镜强度');
    expect(body).not.toContain('导出照片');
    expect(body).toContain('柔光');
    await noHorizontalOverflow(page);
    if (testInfo.project.name === 'desktop') {
      await expect(page.getByRole('radio', { name: 'JPG' })).toBeChecked();
      await expect(page.getByText('Quality 92%')).toBeVisible();
      await saveShot(page, 'desktop-en-export');
      return;
    }
    await expect(page.getByRole('radio', { name: 'PNG' })).toBeChecked();
    await saveShot(page, 'mobile-en-export');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export photo' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('photo-easypic.png');
    const filterCalls = requests.filter((request) => request.url().includes('/api/filters'));
    expect(filterCalls.every((request) => request.url().includes('/easypic/api/filters'))).toBe(true);
    expect(filterCalls.some((request) => request.url().includes('/easypic/en/api/'))).toBe(false);
    expect(requests.some((request) => request.url().includes('/easypic/assets/'))).toBe(true);
    expect(requests.some((request) => request.url().includes('/easypic/en/assets/'))).toBe(false);
    expect(requests.some((request) => request.postData()?.includes('photo'))).toBe(false);
  });
});
