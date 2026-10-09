export interface Argon2Config {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

export interface AppConfig {
  env: string;
  port: number;
  dbPath: string;
  sessionSecret: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  cookiePath: string;
  adminUsername: string;
  adminPassword: string;
  /** True only when EASYPIC_ADMIN_RESET_PASSWORD is exactly '1' (bootstrap password reset, spec §14). */
  adminResetPassword: boolean;
  argon2: Argon2Config;
  loginRateLimit: { max: number; timeWindow: string };
}

/**
 * Config for the operator CLIs (`dist/bin/admin.js`, `dist/bin/import-ncp.js`).
 * Deliberately narrower than AppConfig: recovery must work even when
 * session-related env is absent, and hashing only depends on the argon2 params.
 */
export interface AdminCliConfig {
  dbPath: string;
  argon2: Argon2Config;
}

function buildArgon2(env: Record<string, string | undefined>, isProd: boolean): Argon2Config {
  return {
    memoryCost: Number(env.EASYPIC_ARGON2_MEMORY_KIB ?? (isProd ? 65536 : 1024)),
    timeCost: Number(env.EASYPIC_ARGON2_TIME ?? (isProd ? 3 : 1)),
    parallelism: Number(env.EASYPIC_ARGON2_PARALLELISM ?? 1),
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  const dbPath = env.EASYPIC_DB;
  if (!dbPath) throw new Error('EASYPIC_DB is required');
  const sessionSecret = env.EASYPIC_SESSION_SECRET;
  if (!sessionSecret) throw new Error('EASYPIC_SESSION_SECRET is required');

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3000),
    dbPath,
    sessionSecret,
    sessionTtlHours: Number(env.EASYPIC_SESSION_TTL_HOURS ?? 12),
    cookieSecure: env.EASYPIC_COOKIE_SECURE !== undefined ? env.EASYPIC_COOKIE_SECURE === 'true' : isProd,
    cookiePath: env.EASYPIC_COOKIE_PATH ?? '/',
    adminUsername: env.EASYPIC_ADMIN_USERNAME ?? 'admin',
    adminPassword: env.EASYPIC_ADMIN_PASSWORD ?? '',
    adminResetPassword: env.EASYPIC_ADMIN_RESET_PASSWORD === '1',
    argon2: buildArgon2(env, isProd),
    loginRateLimit: {
      max: Number(env.EASYPIC_LOGIN_RATE_MAX ?? (isProd ? 5 : 1000)),
      timeWindow: env.EASYPIC_LOGIN_RATE_WINDOW ?? '1 minute',
    },
  };
}

export function loadAdminCliConfig(env: Record<string, string | undefined> = process.env): AdminCliConfig {
  const dbPath = env.EASYPIC_DB;
  if (!dbPath) throw new Error('EASYPIC_DB is required');
  const isProd = (env.NODE_ENV ?? 'development') === 'production';
  return { dbPath, argon2: buildArgon2(env, isProd) };
}
