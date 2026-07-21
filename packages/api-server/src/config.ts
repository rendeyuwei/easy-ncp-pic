export interface AppConfig {
  env: string;
  port: number;
  dbPath: string;
  sessionSecret: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  adminUsername: string;
  adminPassword: string;
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  loginRateLimit: { max: number; timeWindow: string };
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
    adminUsername: env.EASYPIC_ADMIN_USERNAME ?? 'admin',
    adminPassword: env.EASYPIC_ADMIN_PASSWORD ?? '',
    argon2: {
      memoryCost: Number(env.EASYPIC_ARGON2_MEMORY_KIB ?? (isProd ? 65536 : 1024)),
      timeCost: Number(env.EASYPIC_ARGON2_TIME ?? (isProd ? 3 : 1)),
      parallelism: Number(env.EASYPIC_ARGON2_PARALLELISM ?? 1),
    },
    loginRateLimit: {
      max: Number(env.EASYPIC_LOGIN_RATE_MAX ?? (isProd ? 5 : 1000)),
      timeWindow: env.EASYPIC_LOGIN_RATE_WINDOW ?? '1 minute',
    },
  };
}
