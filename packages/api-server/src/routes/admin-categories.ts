import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import type { AuthHooks } from '../auth/hooks';
import { ApiError } from '../errors';
import { mapAdminConstraint, normalizeAdminBody, SLUG_PATTERN } from './admin-input';

export function registerAdminCategoryRoutes(app: FastifyInstance, ctx: AppContext, hooks: AuthHooks): void {
  const cats = ctx.db.repos.categories;

  app.get('/api/admin/categories', { preHandler: [hooks.requireAuth] }, async () => {
    return { categories: cats.listAll() };
  });

  app.post(
    '/api/admin/categories',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      preValidation: normalizeAdminBody('category-create'),
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            slug: { type: 'string', minLength: 1, maxLength: 60, pattern: SLUG_PATTERN },
            sortOrder: { type: 'integer' }, isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const b = req.body as { name: string; slug?: string; sortOrder?: number; isEnabled?: boolean };
      let category;
      try {
        category = cats.create({ name: b.name, slug: b.slug, sortOrder: b.sortOrder, isEnabled: b.isEnabled });
      } catch (e) {
        const mapped = mapAdminConstraint(e);
        if (mapped) throw mapped;
        throw e;
      }
      return reply.code(201).send({ category });
    },
  );

  app.patch(
    '/api/admin/categories/:id',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      preValidation: normalizeAdminBody('category-patch'),
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            slug: { type: 'string', minLength: 1, maxLength: 60, pattern: SLUG_PATTERN },
            sortOrder: { type: 'integer' }, isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as { name?: string; slug?: string; sortOrder?: number; isEnabled?: boolean };
      let category;
      try {
        category = cats.update(id, b);
      } catch (e) {
        const mapped = mapAdminConstraint(e);
        if (mapped) throw mapped;
        throw e;
      }
      if (!category) throw new ApiError(404, 'NOT_FOUND', 'Category not found');
      return { category };
    },
  );

  app.delete('/api/admin/categories/:id', { preHandler: [hooks.requireAuth, hooks.requireCsrf] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const deleted = cats.delete(id);
      if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Category not found');
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as { code?: string }).code?.includes('SQLITE_CONSTRAINT')) {
        throw new ApiError(409, 'CATEGORY_IN_USE', 'Cannot delete a category that still has filters');
      }
      throw e;
    }
    return reply.code(204).send();
  });
}
