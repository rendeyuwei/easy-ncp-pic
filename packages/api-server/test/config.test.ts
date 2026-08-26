import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  EASYPIC_DB: '/data/app.db',
  EASYPIC_SESSION_SECRET: 'secret',
  EASYPIC_ADMIN_PASSWORD: 'pw',
};

describe('loadConfig', () => {
  it('loads with defaults in development', () => {
    const c = loadConfig({ NODE_ENV: 'development', ...base });
    expect(c.env).toBe('development');
    expect(c.port).toBe(3000);
    expect(c.dbPath).toBe('/data/app.db');
    expect(c.sessionSecret).toBe('secret');
    expect(c.sessionTtlHours).toBe(12);
    expect(c.cookieSecure).toBe(false);
    expect(c.cookiePath).toBe('/');
    expect(c.adminUsername).toBe('admin');
    expect(c.adminPassword).toBe('pw');
    expect(c.loginRateLimit.max).toBeGreaterThan(100); // dev: permissive
  });

  it('defaults cookieSecure to true in production', () => {
    const c = loadConfig({ NODE_ENV: 'production', ...base });
    expect(c.cookieSecure).toBe(true);
    expect(c.loginRateLimit.max).toBeLessThanOrEqual(10); // prod: strict
    expect(c.argon2.memoryCost).toBeGreaterThanOrEqual(65536);
  });

  it('honors explicit overrides', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      ...base,
      PORT: '8080',
      EASYPIC_COOKIE_SECURE: 'false',
      EASYPIC_COOKIE_PATH: '/easypic/',
      EASYPIC_SESSION_TTL_HOURS: '24',
      EASYPIC_ADMIN_USERNAME: 'root',
      EASYPIC_LOGIN_RATE_MAX: '7',
    });
    expect(c.port).toBe(8080);
    expect(c.cookieSecure).toBe(false);
    expect(c.cookiePath).toBe('/easypic/');
    expect(c.sessionTtlHours).toBe(24);
    expect(c.adminUsername).toBe('root');
    expect(c.loginRateLimit.max).toBe(7);
  });

  it('throws when EASYPIC_DB is missing', () => {
    expect(() => loadConfig({ EASYPIC_SESSION_SECRET: 's', EASYPIC_ADMIN_PASSWORD: 'p' })).toThrow(/EASYPIC_DB/);
  });

  it('throws when EASYPIC_SESSION_SECRET is missing', () => {
    expect(() => loadConfig({ EASYPIC_DB: '/d.db', EASYPIC_ADMIN_PASSWORD: 'p' })).toThrow(/EASYPIC_SESSION_SECRET/);
  });
});
