import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import type { AuthHooks } from '../auth/hooks';
import { SESSION_COOKIE } from '../auth/hooks';
import { verifyPassword } from '../auth/password';
import { ApiError } from '../errors';

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
      const ok = admin ? await verifyPassword(ctx.config, admin.passwordHash, password) : false;
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
      return reply.code(200).send({ csrfToken: created.csrfToken });
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
