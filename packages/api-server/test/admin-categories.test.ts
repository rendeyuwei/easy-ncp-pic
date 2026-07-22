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

  it('rejects create without CSRF (403)', async () => {
    const { app, cookie } = await authed();
    const res = await app.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
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

  it('returns 404 when patching a missing category', async () => {
    const { app, cookie, csrf } = await authed();
    const res = await app.app.inject({ method: 'PATCH', url: '/api/admin/categories/nope', headers: { cookie, ...csrf }, payload: { name: 'x' } });
    expect(res.statusCode).toBe(404);
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
