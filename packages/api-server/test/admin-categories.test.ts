import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, login, type TestApp } from './helpers/build-test-app';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

async function authed() {
  const app = await buildTestApp();
  t = app;
  const { cookie, csrfToken } = await login(app.app);
  return { app, cookie, csrf: { 'x-csrf-token': csrfToken } };
}

describe('admin categories', () => {
  it('requires auth to list', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/categories' });
    expect(res.statusCode).toBe(401);
  });

  it('creates a category (201) with auth + CSRF', async () => {
    const { app, cookie, csrf } = await authed();
    const res = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.category.name).toBe('Film');
    expect(body.category.slug).toBe('film');
  });

  it('trims category input and derives a slug when create slug is blank', async () => {
    const { app, cookie, csrf } = await authed();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf },
      payload: { name: '  Film Lab  ', slug: '   ', sortOrder: 2 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().category).toMatchObject({ name: 'Film Lab', slug: 'film-lab', sortOrder: 2 });
  });

  it('maps duplicate category slugs to SLUG_CONFLICT', async () => {
    const { app, cookie, csrf } = await authed();
    await app.app.inject({
      method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf },
      payload: { name: 'Film One', slug: 'shared' },
    });
    const second = await app.app.inject({
      method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf },
      payload: { name: 'Film Two', slug: 'shared' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'SLUG_CONFLICT' });
  });

  it.each([
    [{ name: 'x'.repeat(101) }],
    [{ name: 'Film', slug: 'not_a_slug' }],
    [{ name: 'Film', slug: 'a'.repeat(61) }],
    [{ name: 'Film', sortOrder: 1.5 }],
    [{ name: 'Film', sortOrder: '1' }],
  ])('rejects invalid category create input: %o', async (payload) => {
    const { app, cookie, csrf } = await authed();
    const res = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('rejects create without CSRF (403)', async () => {
    const { app, cookie } = await authed();
    const res = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a null request body with VALIDATION_ERROR', async () => {
    const { app, cookie, csrf } = await authed();
    const res = await app.app.inject({
      method: 'POST', url: '/api/admin/categories',
      headers: { cookie, ...csrf, 'content-type': 'application/json' }, payload: 'null',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('lists, updates, and deletes a category', async () => {
    const { app, cookie, csrf } = await authed();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
    const id = created.json().category.id as string;

    const list = await app.app.inject({ method: 'GET', url: '/api/admin/categories', headers: { cookie } });
    expect(list.json().categories).toHaveLength(1);

    const patched = await app.app.inject({ method: 'PATCH', url: `/api/admin/categories/${id}`, headers: { cookie, ...csrf }, payload: { name: 'Cinema', isEnabled: false } });
    expect(patched.json().category.name).toBe('Cinema');
    expect(patched.json().category.isEnabled).toBe(false);

    const del = await app.app.inject({ method: 'DELETE', url: `/api/admin/categories/${id}`, headers: { cookie, ...csrf } });
    expect(del.statusCode).toBe(204);
  });

  it('trims a category patch name without changing its slug', async () => {
    const { app, cookie, csrf } = await authed();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film Lab' } });
    const originalSlug = created.json().category.slug as string;
    const res = await app.app.inject({ method: 'PATCH', url: `/api/admin/categories/${created.json().category.id}`, headers: { cookie, ...csrf }, payload: { name: '  Cinema Lab  ' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().category).toMatchObject({ name: 'Cinema Lab', slug: originalSlug });
  });

  it('maps a duplicate category patch slug to SLUG_CONFLICT', async () => {
    const { app, cookie, csrf } = await authed();
    const first = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film One', slug: 'shared' } });
    const second = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film Two', slug: 'other' } });
    const res = await app.app.inject({ method: 'PATCH', url: `/api/admin/categories/${second.json().category.id}`, headers: { cookie, ...csrf }, payload: { slug: first.json().category.slug } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'SLUG_CONFLICT' });
  });

  it('returns 404 when patching a missing category', async () => {
    const { app, cookie, csrf } = await authed();
    const res = await app.app.inject({ method: 'PATCH', url: '/api/admin/categories/nope', headers: { cookie, ...csrf }, payload: { name: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    {},
    { slug: '   ' },
    { name: 'x'.repeat(101) },
    { slug: 'not_a_slug' },
    { slug: 'a'.repeat(61) },
    { sortOrder: 1.5 },
    { sortOrder: '1' },
  ])('rejects invalid category patch input: %o', async (payload) => {
    const { app, cookie, csrf } = await authed();
    const created = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
    const res = await app.app.inject({ method: 'PATCH', url: `/api/admin/categories/${created.json().category.id}`, headers: { cookie, ...csrf }, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('returns 409 CATEGORY_IN_USE when deleting a category that has filters', async () => {
    const { app, cookie, csrf } = await authed();
    const cat = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
    const catId = cat.json().category.id as string;
    // Insert a filter referencing the category directly via the repository.
    app.db.repos.filters.create({
      displayName: 'F', sourceName: 'F', categoryId: catId,
      ncpBlob: new Uint8Array([1]), ncpSha256: 'sha-1', parserVersion: 1, parsedJson: '{}',
    });
    const del = await app.app.inject({ method: 'DELETE', url: `/api/admin/categories/${catId}`, headers: { cookie, ...csrf } });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe('CATEGORY_IN_USE');
  });
});
