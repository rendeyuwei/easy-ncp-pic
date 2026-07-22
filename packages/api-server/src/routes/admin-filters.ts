import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { parseNcp, NcpParseError } from '@easypic/ncp-parser';
import type { AppContext } from '../app';
import type { AuthHooks } from '../auth/hooks';
import { ApiError } from '../errors';

export const MAX_NCP_BYTES = 64 * 1024;

export function registerAdminFilterRoutes(app: FastifyInstance, ctx: AppContext, hooks: AuthHooks): void {
  const filters = ctx.db.repos.filters;

  app.get('/api/admin/filters', { preHandler: [hooks.requireAuth] }, async () => {
    return { filters: filters.listAll() };
  });

  app.post(
    '/api/admin/filters',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      bodyLimit: MAX_NCP_BYTES,
      schema: {
        body: {
          type: 'object',
          required: ['ncpBase64', 'displayName', 'categoryId'],
          properties: {
            ncpBase64: { type: 'string' },
            displayName: { type: 'string' },
            categoryId: { type: 'string' },
            description: { type: 'string' },
            slug: { type: 'string' },
            sortOrder: { type: 'integer' },
            isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const b = req.body as {
        ncpBase64: string; displayName: string; categoryId: string;
        description?: string; slug?: string; sortOrder?: number; isEnabled?: boolean;
      };

      const bytes = new Uint8Array(Buffer.from(b.ncpBase64, 'base64'));
      if (bytes.length === 0) {
        throw new ApiError(422, 'INVALID_NCP', 'Empty NCP data');
      }

      let parsed: ReturnType<typeof parseNcp>;
      try {
        parsed = parseNcp(bytes);
      } catch (e) {
        if (e instanceof NcpParseError) {
          throw new ApiError(422, 'INVALID_NCP', `Invalid NCP file (${e.code})`);
        }
        throw e;
      }
      if (!parsed.supported) {
        throw new ApiError(422, 'UNSUPPORTED_NCP', 'Unsupported NCP variant');
      }

      const ncpSha256 = createHash('sha256').update(bytes).digest('hex');
      const existing = filters.findBySha256(ncpSha256);
      if (existing) {
        throw new ApiError(409, 'DUPLICATE_NCP', `This Picture Control is already published as "${existing.displayName}"`);
      }

      try {
        const filter = filters.create({
          displayName: b.displayName,
          sourceName: parsed.sourceName,
          description: b.description ?? '',
          categoryId: b.categoryId,
          slug: b.slug,
          sortOrder: b.sortOrder,
          isEnabled: b.isEnabled,
          ncpBlob: bytes,
          ncpSha256,
          parserVersion: parsed.schemaVersion,
          parsedJson: JSON.stringify(parsed),
        });
        return reply.code(201).send({ filter });
      } catch (e) {
        const err = e as { code?: string; message?: string };
        if (err.code?.includes('SQLITE_CONSTRAINT')) {
          // better-sqlite3 names the offending column in the message, e.g.
          // "UNIQUE constraint failed: filters.ncp_sha256". Discriminate so a genuine
          // duplicate isn't misreported as a bad category, and a slug collision isn't
          // reported as 'Invalid category'.
          const message = err.message ?? '';
          if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
            // category_id does not reference an existing category.
            throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid category');
          }
          if (message.includes('ncp_sha256')) {
            // The pre-check passed but a concurrent write inserted the same NCP.
            throw new ApiError(409, 'DUPLICATE_NCP', 'This Picture Control is already published');
          }
          if (message.includes('slug')) {
            throw new ApiError(409, 'DUPLICATE_NCP', 'A filter with this slug already exists');
          }
        }
        throw e;
      }
    },
  );

  app.patch(
    '/api/admin/filters/:id',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      schema: {
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string' },
            description: { type: 'string' },
            categoryId: { type: 'string' },
            slug: { type: 'string' },
            sortOrder: { type: 'integer' },
            isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as { displayName?: string; description?: string; categoryId?: string; slug?: string; sortOrder?: number; isEnabled?: boolean };
      const filter = filters.update(id, b);
      if (!filter) throw new ApiError(404, 'NOT_FOUND', 'Filter not found');
      return { filter };
    },
  );

  app.delete('/api/admin/filters/:id', { preHandler: [hooks.requireAuth, hooks.requireCsrf] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = filters.delete(id);
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Filter not found');
    return reply.code(204).send();
  });
}
