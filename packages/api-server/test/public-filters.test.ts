import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTestApp, login, type TestApp } from './helpers/build-test-app';

const here = dirname(fileURLToPath(import.meta.url));
const ncpBase64 = () => readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')).toString('base64');

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

async function publishEnabledFilter(enabled = true) {
  t = await buildTestApp();
  const { cookie, csrfToken } = await login(t.app);
  const csrf = { 'x-csrf-token': csrfToken };
  const cat = await t.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
  const categoryId = cat.json().category.id as string;
  await t.app.inject({
    method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
    payload: { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId, isEnabled: enabled },
  });
  return { categoryId };
}

describe('GET /api/filters (public)', () => {
  it('returns enabled filters grouped by category with parsed params, no blob', async () => {
    await publishEnabledFilter(true);
    const res = await t!.app.inject({ method: 'GET', url: '/api/filters' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0].name).toBe('Film');
    expect(body.categories[0].filters).toHaveLength(1);
    const f = body.categories[0].filters[0];
    expect(f.displayName).toBe('Fuji Astia');
    expect(f.parsed.sourceName).toBe('Fuji Astia');
    expect(f).not.toHaveProperty('ncpBlob');
    expect(res.body).not.toContain('ncpBlob');
  });

  it('excludes disabled filters', async () => {
    await publishEnabledFilter(false);
    const res = await t!.app.inject({ method: 'GET', url: '/api/filters' });
    expect(res.json().categories).toHaveLength(0);
  });

  it('sends an ETag and returns 304 when If-None-Match matches', async () => {
    await publishEnabledFilter(true);
    const first = await t!.app.inject({ method: 'GET', url: '/api/filters' });
    const etag = first.headers['etag'];
    expect(etag).toBeTruthy();
    const second = await t!.app.inject({ method: 'GET', url: '/api/filters', headers: { 'if-none-match': String(etag) } });
    expect(second.statusCode).toBe(304);
  });
});
