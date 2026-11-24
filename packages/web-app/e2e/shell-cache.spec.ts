import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';

// shell-topbar.js / shell-topbar.css are the actual rende-site fdaa701 bytes.
// topbar-2026-10-22.js is the historical unversioned Chinese bar, used only to seed the disk cache.
const TOPBAR = '/shell/topbar.4a304e017601ad56e80a5c39886c186fa462161ce585d093ae92c4cfc17edd7b.js';
const CSS = '/shell/topbar.918f2c1a3eaa24581dfb11b360b323fa925b5a2548108b6ad5d8bd98ff3cc23b.css';
const fixtureDir = join(process.cwd(), 'src/test/fixtures');
const actualTopbar = readFileSync(join(fixtureDir, 'shell-topbar.js'));
const actualCss = readFileSync(join(fixtureDir, 'shell-topbar.css'));
const oldTopbar = readFileSync(join(fixtureDir, 'topbar-2026-10-22.js'));

const lut257 = Array.from({ length: 257 }, (_, index) => index / 256);
const filters = JSON.stringify({
  categories: [{
    id: 'category-film',
    name: '胶片',
    slug: 'film',
    sortOrder: 10,
    filters: [{
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
    }],
  }],
});

function send(response: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string>): void {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  response.writeHead(status, { 'content-length': String(payload.length), ...headers });
  response.end(payload);
}

function startServer(): Promise<{ origin: string; legacy: () => number; hashed: () => number; close: () => Promise<void> }> {
  const webDist = join(process.cwd(), 'dist');
  const counts = { legacy: 0, hashed: 0 };
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/shell/topbar.js') {
      counts.legacy += 1;
      // The stored response had no Cache-Control. Do not send no-cache or no-store.
      send(response, 200, oldTopbar, {
        'content-type': 'text/javascript; charset=utf-8',
        'last-modified': 'Thu, 22 Oct 2026 03:35:52 GMT',
      });
      return;
    }
    if (url.pathname === TOPBAR) {
      counts.hashed += 1;
      send(response, 200, actualTopbar, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      });
      return;
    }
    if (url.pathname === CSS) {
      send(response, 200, actualCss, {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'public, max-age=31536000, immutable',
      });
      return;
    }
    if (url.pathname === '/cache-seed.html') {
      send(response, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>seed</title></head><body><script src="/shell/topbar.js" defer></script></body></html>`, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
      });
      return;
    }
    if (url.pathname === '/easypic/api/filters') {
      send(response, 200, filters, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      return;
    }
    const pathname = decodeURIComponent(url.pathname);
    let relative = '';
    if (pathname === '/easypic' || pathname === '/easypic/') relative = 'index.html';
    else if (pathname === '/easypic/en' || pathname === '/easypic/en/') relative = 'en/index.html';
    else if (pathname.startsWith('/easypic/')) relative = pathname.slice('/easypic/'.length);
    else {
      send(response, 404, 'missing', { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return;
    }
    const file = join(webDist, relative);
    if (!file.startsWith(webDist) || relative.split('/').includes('..')) {
      send(response, 404, 'missing', { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return;
    }
    let info;
    try {
      info = statSync(file);
    } catch {
      send(response, 404, 'missing', { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      return;
    }
    const target = info.isDirectory() ? join(file, 'index.html') : file;
    const type = extname(target) === '.html'
      ? 'text/html; charset=utf-8'
      : extname(target) === '.js'
        ? 'text/javascript; charset=utf-8'
        : extname(target) === '.css'
          ? 'text/css; charset=utf-8'
          : 'application/octet-stream';
    response.writeHead(200, {
      'content-type': type,
      'cache-control': extname(target) === '.html' ? 'no-cache' : 'no-store',
    });
    createReadStream(target).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('missing port');
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        legacy: () => counts.legacy,
        hashed: () => counts.hashed,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

async function buttonText(page: Page): Promise<string> {
  await page.waitForSelector('.rf-btn', { timeout: 8_000 });
  return page.evaluate(() => {
    const node = document.querySelector('.rf-btn');
    if (!node) return '';
    return [...node.childNodes]
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? '')
      .join('')
      .trim();
  });
}

test.beforeAll(() => {
  expect(createHash('sha256').update(actualTopbar).digest('hex')).toBe('4a304e017601ad56e80a5c39886c186fa462161ce585d093ae92c4cfc17edd7b');
  expect(actualTopbar.length).toBe(9981);
  expect(actualTopbar.includes(Buffer.from('topbar.918f2c1a3eaa24581dfb11b360b323fa925b5a2548108b6ad5d8bd98ff3cc23b.css'))).toBe(true);
  expect(actualCss.length).toBe(2807);
  expect(oldTopbar.includes(Buffer.from('4a304e017601ad56'))).toBe(false);
  execFileSync('pnpm', ['exec', 'vite', 'build'], {
    env: { ...process.env, EASYPIC_DEPLOY_PREFIX: 'easypic' },
    stdio: 'inherit',
  });
});

function openProfile(dir: string) {
  return chromium.launchPersistentContext(dir, {
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disk-cache-size=67108864',
      `--disk-cache-dir=${join(dir, 'disk-cache')}`,
    ],
  });
}

test('keeps an English menu and the open photo when the old unversioned topbar is already cached', async () => {
  test.setTimeout(120_000);
  const server = await startServer();
  const dir = mkdtempSync(join(tmpdir(), 'easypic-shell-cache-'));
  try {
    const first = await openProfile(dir);
    try {
      const page = first.pages()[0] ?? await first.newPage();
      await page.goto(`${server.origin}/cache-seed.html`, { waitUntil: 'domcontentloaded' });
      expect(await buttonText(page)).toBe('工具');
      expect(server.legacy()).toBe(1);
    } finally {
      await first.close();
    }

    const second = await openProfile(dir);
    try {
      const page = second.pages()[0] ?? await second.newPage();
      await page.goto(`${server.origin}/cache-seed.html?again=1`, { waitUntil: 'domcontentloaded' });
      expect(await buttonText(page)).toBe('工具');
      expect(server.legacy()).toBe(1);
      expect(server.hashed()).toBe(0);

      await page.goto(`${server.origin}/easypic/en/`, { waitUntil: 'domcontentloaded' });
      expect(await buttonText(page)).toBe('Tools');
      expect(server.hashed()).toBe(1);
      expect(server.legacy()).toBe(1);
      const html = await page.content();
      expect(html).toContain(`src="${TOPBAR}"`);
      expect(html).not.toContain('src="/shell/topbar.js"');

      await page.getByLabel('Choose a photo').setInputFiles('e2e/fixtures/photo.png');
      await page.getByRole('button', { name: /柔光/ }).click();
      await expect(page.getByRole('heading', { name: '柔光' })).toBeVisible();
      await page.evaluate(() => {
        (window as Window & { __easypicDoc?: number }).__easypicDoc = 1;
      });
      const historyBefore = await page.evaluate(() => history.length);
      await page.locator('a.rf-lang').click();
      await expect(page).toHaveURL(/\/easypic\/\?lang=zh/);
      await expect(page.locator('a.rf-lang')).toBeFocused();
      await expect(page.getByRole('heading', { name: '柔光' })).toBeVisible();
      expect(await buttonText(page)).toBe('工具');
      expect(await page.evaluate(() => (window as Window & { __easypicDoc?: number }).__easypicDoc)).toBe(1);
      expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);
      expect(await page.evaluate(() => document.querySelectorAll('script[src*="topbar"]').length)).toBe(1);
      expect(server.legacy()).toBe(1);
      expect(server.hashed()).toBe(1);
    } finally {
      await second.close();
    }
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
