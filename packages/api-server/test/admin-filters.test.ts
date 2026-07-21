import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTestApp, login, type TestApp } from './helpers/build-test-app';

const here = dirname(fileURLToPath(import.meta.url));
const PICCON02 = join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP');
const ncpBase64 = () => readFileSync(PICCON02).toString('base64');

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

async function authedWithCategory() {
  const app = await buildTestApp();
  t = app;
  const { cookie, csrfToken } = await login(app.app);
  const csrf = { 'x-csrf-token': csrfToken };
  const cat = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
  return { app, cookie, csrf, categoryId: cat.json().category.id as string };
}

describe('POST /api/admin/filters (NCP upload)', () => {
  it('uploads a valid NCP and stores it (201)', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId },
    });
    expect(res.statusCode).toBe(201);
    const f = res.json().filter;
    expect(f.displayName).toBe('Fuji Astia');
    expect(f.sourceName).toBe('Fuji Astia'); // from the NCP itself
    expect(f.parserVersion).toBe(1);
    expect(JSON.parse(f.parsedJson).sourceName).toBe('Fuji Astia');
    // The raw blob is stored and retrievable.
    expect(app.db.repos.filters.getNcpBlob(f.id)).toBeInstanceOf(Uint8Array);
  });

  it('rejects an invalid NCP with 422 INVALID_NCP (no stack leak)', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const garbage = Buffer.from('not a real ncp file at all').toString('base64');
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: garbage, displayName: 'X', categoryId },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_NCP');
    expect(res.body).not.toContain(' at ');
  });

  it('detects a duplicate NCP by SHA-256 (409 DUPLICATE_NCP)', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const payload = { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId };
    const first = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload });
    expect(first.statusCode).toBe(201);
    const second = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('DUPLICATE_NCP');
  });

  it('rejects an invalid category with 400', async () => {
    const { app, cookie, csrf } = await authedWithCategory();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: 'X', categoryId: 'missing-cat' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('enforces the 64 KiB body limit (413)', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: 'A'.repeat(70000), displayName: 'X', categoryId },
    });
    expect(res.statusCode).toBe(413);
  });

  it('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
    const { app, cookie, csrf } = await authedWithCategory();
    const res = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { displayName: 'X' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('lists filters for an admin (GET)', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId } });
    const res = await app.app.inject({ method: 'GET', url: '/api/admin/filters', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().filters).toHaveLength(1);
  });
});
