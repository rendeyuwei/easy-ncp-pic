import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config';
import type { AppDb } from './db';
import type { SessionService } from './auth/session';
import { ApiError, registerErrorHandler } from './errors';
import { registerHealthRoutes } from './routes/health';
import { createAuthHooks } from './auth/hooks';
import { registerAdminAuthRoutes } from './routes/admin-auth';
import { registerAdminCategoryRoutes } from './routes/admin-categories';

export interface AppContext {
  config: AppConfig;
  db: AppDb;
  sessions: SessionService;
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: ctx.config.env !== 'test', bodyLimit: 1024 * 1024 });

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) =>
      new ApiError(429, 'RATE_LIMITED', `Too many requests, retry in ${context.after}`),
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, ctx);
  const hooks = createAuthHooks(ctx);
  registerAdminAuthRoutes(app, ctx, hooks);
  registerAdminCategoryRoutes(app, ctx, hooks);

  return app;
}
