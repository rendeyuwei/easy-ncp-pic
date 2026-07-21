import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config';
import type { AppDb } from './db';
import type { SessionService } from './auth/session';
import { registerErrorHandler } from './errors';
import { registerHealthRoutes } from './routes/health';

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
    errorResponseBuilder: (_req, context) => ({
      code: 'RATE_LIMITED',
      message: `Too many requests, retry in ${context.after}`,
    }),
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, ctx);

  return app;
}
