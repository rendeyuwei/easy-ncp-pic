import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminSessionRecord } from '@easypic/database';
import { ApiError } from '../errors';
import { safeEqual } from './tokens';
import type { AppContext } from '../app';

export const SESSION_COOKIE = 'sid';
export const CSRF_HEADER = 'x-csrf-token';

declare module 'fastify' {
  interface FastifyRequest {
    session?: AdminSessionRecord;
  }
}

export interface AuthHooks {
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireCsrf: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function createAuthHooks(ctx: AppContext): AuthHooks {
  return {
    async requireAuth(req, _reply) {
      const token = req.cookies?.[SESSION_COOKIE];
      if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
      const session = ctx.sessions.findByToken(token);
      if (!session || !ctx.sessions.isValid(session)) {
        if (session) ctx.sessions.revoke(session.id);
        throw new ApiError(401, 'UNAUTHORIZED', 'Session invalid or expired');
      }
      ctx.sessions.touch(session.id);
      req.session = session;
    },
    async requireCsrf(req, _reply) {
      const session = req.session;
      if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
      const provided = req.headers[CSRF_HEADER];
      if (typeof provided !== 'string' || !safeEqual(provided, session.csrfSecret)) {
        throw new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token');
      }
    },
  };
}
