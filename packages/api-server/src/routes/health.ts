import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (_req, reply) => {
    let dbOk = true;
    try {
      ctx.db.db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    return reply.code(dbOk ? 200 : 503).send({ status: dbOk ? 'ok' : 'error', database: dbOk ? 'ok' : 'error' });
  });
}
