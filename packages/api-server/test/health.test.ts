import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/build-test-app';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

describe('GET /api/health', () => {
  it('returns ok with database status and no sensitive config', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
    expect(res.body).not.toContain('test-session-secret');
  });

  it('sets security headers (helmet)', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
