import type { FastifyInstance } from 'fastify';
import { buildApp, type AppContext } from '../../src/app';
import { initDb, type AppDb } from '../../src/db';
import { SessionService } from '../../src/auth/session';
import { hashPassword } from '../../src/auth/password';
import type { AppConfig } from '../../src/config';

export const TEST_PASSWORD = 'test-password-123';

export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    env: 'test',
    port: 0,
    dbPath: ':memory:',
    sessionSecret: 'test-session-secret',
    sessionTtlHours: 12,
    cookieSecure: false,
    adminUsername: 'admin',
    adminPassword: TEST_PASSWORD,
    argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 },
    loginRateLimit: { max: 1000, timeWindow: '1 minute' },
    ...over,
  };
}

export interface TestApp {
  app: FastifyInstance;
  db: AppDb;
  config: AppConfig;
  ctx: AppContext;
}

export async function buildTestApp(config: AppConfig = testConfig()): Promise<TestApp> {
  const db = initDb(config.dbPath);
  const passwordHash = await hashPassword(config, config.adminPassword);
  db.repos.admins.create({ username: config.adminUsername, passwordHash });
  const sessions = new SessionService(config, db.repos);
  const ctx: AppContext = { config, db, sessions };
  const app = await buildApp(ctx);
  await app.ready();
  return { app, db, config, ctx };
}

export interface LoginResult {
  status: number;
  cookie: string; // "sid=..." (the cookie header value to send back)
  csrfToken: string;
}

export async function login(
  app: FastifyInstance,
  username = 'admin',
  password = TEST_PASSWORD,
): Promise<LoginResult> {
  const res = await app.inject({ method: 'POST', url: '/api/admin/session', payload: { username, password } });
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = (raw ?? '').split(';')[0];
  const body = res.json() as { csrfToken?: string };
  return { status: res.statusCode, cookie, csrfToken: body.csrfToken ?? '' };
}
