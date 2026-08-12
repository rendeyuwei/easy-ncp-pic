import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTestApp, login, type TestApp } from './helpers/build-test-app';

const here = dirname(fileURLToPath(import.meta.url));
const PICCON02 = join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP');
const PICCON33 = join(here, '../../ncp-parser/test/fixtures/PICCON33.NCP');
const ncpBase64 = () => readFileSync(PICCON02).toString('base64');
const ncpBase64Alt = () => readFileSync(PICCON33).toString('base64');

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

  it('trims filter input and derives a slug when create slug is blank', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: '  Film Lab  ', description: '  Notes  ', slug: '   ', categoryId },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().filter).toMatchObject({ displayName: 'Film Lab', description: 'Notes', slug: 'film-lab' });
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

  it('rejects an invalid category (FK violation) with 400 VALIDATION_ERROR', async () => {
    const { app, cookie, csrf } = await authedWithCategory();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: 'X', categoryId: 'missing-cat' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('maps a slug UNIQUE collision to SLUG_CONFLICT', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    // Two distinct NCPs (different sha256) forced to the same slug.
    const first = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId, slug: 'shared-slug' },
    });
    expect(first.statusCode).toBe(201);
    const second = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64Alt(), displayName: 'Mono', categoryId, slug: 'shared-slug' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('SLUG_CONFLICT');
  });

  it.each([
    { displayName: 'x'.repeat(101) },
    { description: 'x'.repeat(501) },
    { slug: 'not_a_slug' },
    { slug: 'a'.repeat(61) },
    { sortOrder: 1.5 },
    { sortOrder: '1' },
  ])('rejects invalid filter create input: %o', async (overrides) => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: 'Film', categoryId, ...overrides },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
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

describe('PATCH/DELETE /api/admin/filters', () => {
  it('edits a filter (display name, enabled) and bumps updated_at', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'Before', categoryId } });
    const id = created.json().filter.id as string;
    const patched = await app.app.inject({ method: 'PATCH', url: `/api/admin/filters/${id}`, headers: { cookie, ...csrf }, payload: { displayName: 'After', isEnabled: false } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().filter.displayName).toBe('After');
    expect(patched.json().filter.isEnabled).toBe(false);
  });

  it('returns 404 when editing a missing filter', async () => {
    const { app, cookie, csrf } = await authedWithCategory();
    const res = await app.app.inject({ method: 'PATCH', url: '/api/admin/filters/nope', headers: { cookie, ...csrf }, payload: { displayName: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    {},
    { slug: '   ' },
    { displayName: 'x'.repeat(101) },
    { description: 'x'.repeat(501) },
    { slug: 'not_a_slug' },
    { slug: 'a'.repeat(61) },
    { sortOrder: 1.5 },
    { sortOrder: '1' },
  ])('rejects invalid filter patch input: %o', async (payload) => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'Before', categoryId } });
    const res = await app.app.inject({ method: 'PATCH', url: `/api/admin/filters/${created.json().filter.id}`, headers: { cookie, ...csrf }, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('maps duplicate filter update slugs to SLUG_CONFLICT', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const first = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'One', categoryId, slug: 'shared' } });
    const second = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64Alt(), displayName: 'Two', categoryId, slug: 'other' } });
    const res = await app.app.inject({ method: 'PATCH', url: `/api/admin/filters/${second.json().filter.id}`, headers: { cookie, ...csrf }, payload: { slug: first.json().filter.slug } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'SLUG_CONFLICT' });
  });

  it('maps a missing filter update category to a categoryId validation error', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'Before', categoryId } });
    const res = await app.app.inject({ method: 'PATCH', url: `/api/admin/filters/${created.json().filter.id}`, headers: { cookie, ...csrf }, payload: { categoryId: 'missing-category' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', errors: [{ field: 'categoryId' }] });
  });

  it('deletes a filter (204) and then 404s on a second delete', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'F', categoryId } });
    const id = created.json().filter.id as string;
    const del = await app.app.inject({ method: 'DELETE', url: `/api/admin/filters/${id}`, headers: { cookie, ...csrf } });
    expect(del.statusCode).toBe(204);
    const again = await app.app.inject({ method: 'DELETE', url: `/api/admin/filters/${id}`, headers: { cookie, ...csrf } });
    expect(again.statusCode).toBe(404);
  });

  it('requires CSRF to delete (403 without token)', async () => {
    const { app, cookie, csrf, categoryId } = await authedWithCategory();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'F', categoryId } });
    const id = created.json().filter.id as string;
    const res = await app.app.inject({ method: 'DELETE', url: `/api/admin/filters/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
