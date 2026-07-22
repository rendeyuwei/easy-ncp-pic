import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, testConfig, login, TEST_PASSWORD, type TestApp } from './helpers/build-test-app';
import { seedInitialAdmin } from '../src/seed';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

describe('POST /api/admin/session (login)', () => {
  it('logs in with valid credentials, sets an HttpOnly sid cookie, and returns a csrfToken', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: TEST_PASSWORD } });
    expect(res.statusCode).toBe(200);
    expect(res.json().csrfToken).toMatch(/^[0-9a-f]{64}$/);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('sid=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });

  it('rejects wrong password with 401 INVALID_CREDENTIALS and no cookie', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects unknown username the same way (no user enumeration)', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'ghost', password: 'x' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 VALIDATION_ERROR when fields are missing', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('locks out after too many failures (rate limit)', async () => {
    t = await buildTestApp(testConfig({ loginRateLimit: { max: 3, timeWindow: '1 minute' } }));
    for (let i = 0; i < 3; i++) {
      await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: 'bad' } });
    }
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: 'bad' } });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
  });
});

describe('DELETE /api/admin/session (logout)', () => {
  it('logs out with a valid session + CSRF token, clearing the cookie', async () => {
    t = await buildTestApp();
    const { cookie, csrfToken } = await login(t.app);
    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/session', headers: { cookie, 'x-csrf-token': csrfToken } });
    expect(res.statusCode).toBe(204);
  });

  it('requires authentication (no cookie -> 401)', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/session' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('requires a valid CSRF token (403 without it)', async () => {
    t = await buildTestApp();
    const { cookie } = await login(t.app);
    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/session', headers: { cookie, 'x-csrf-token': 'wrong' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('CSRF_INVALID');
  });
});

describe('seedInitialAdmin', () => {
  it('creates the admin when none exists and is idempotent', async () => {
    t = await buildTestApp();
    // buildTestApp already created 'admin'; seeding again must not duplicate.
    await seedInitialAdmin(t.config, t.db.repos);
    const admins = t.db.db.prepare('SELECT COUNT(*) AS n FROM admins').get() as { n: number };
    expect(admins.n).toBe(1);
  });
});
