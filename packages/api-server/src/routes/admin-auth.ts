import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import type { AuthHooks } from '../auth/hooks';
import { SESSION_COOKIE } from '../auth/hooks';
import { hashPassword, verifyPassword } from '../auth/password';
import type { AppConfig } from '../config';
import { ApiError } from '../errors';

// A fixed dummy password used to equalize login timing for unknown usernames.
const DUMMY_PASSWORD = 'easypic-dummy-password-for-timing-equalization';

// Caches a dummy Argon2id hash per config (keyed by sessionSecret) so it is computed
// once per app/config rather than per request. Different test apps use different
// secrets, so keying by sessionSecret keeps their cost params independent.
const dummyHashCache = new Map<string, Promise<string>>();

function dummyHashFor(config: AppConfig): Promise<string> {
  let cached = dummyHashCache.get(config.sessionSecret);
  if (!cached) {
    cached = hashPassword(config, DUMMY_PASSWORD);
    dummyHashCache.set(config.sessionSecret, cached);
  }
  return cached;
}

export function registerAdminAuthRoutes(app: FastifyInstance, ctx: AppContext, hooks: AuthHooks): void {
  app.post(
    '/api/admin/session',
    {
      config: { rateLimit: { max: ctx.config.loginRateLimit.max, timeWindow: ctx.config.loginRateLimit.timeWindow } },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string' }, password: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string };
      const admin = ctx.db.repos.admins.findByUsername(username);
      // Always run exactly one Argon2id verify of comparable cost, regardless of
      // whether the username exists. For an unknown user we verify against a cached
      // dummy hash whose cost params match the app config, so the timing does not
      // reveal whether the username is real (prevents username enumeration).
      const hashToCheck = admin ? admin.passwordHash : await dummyHashFor(ctx.config);
      const ok = await verifyPassword(ctx.config, hashToCheck, password);
      if (!admin || !ok) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
      }
      const created = ctx.sessions.create(admin.id);
      reply.setCookie(SESSION_COOKIE, created.token, {
        path: '/',
        httpOnly: true,
        secure: ctx.config.cookieSecure,
        sameSite: 'lax',
        expires: new Date(created.expiresAt),
      });
      reply.header('cache-control', 'no-store');
      return reply.code(200).send({ csrfToken: created.csrfToken });
    },
  );

  app.get(
    '/api/admin/session',
    { preHandler: [hooks.requireAuth] },
    async (req, reply) => {
      reply.header('cache-control', 'no-store');
      return { csrfToken: req.session!.csrfSecret };
    },
  );

  app.delete(
    '/api/admin/session',
    { preHandler: [hooks.requireAuth, hooks.requireCsrf] },
    async (req, reply) => {
      ctx.sessions.revoke(req.session!.id);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send();
    },
  );
}
