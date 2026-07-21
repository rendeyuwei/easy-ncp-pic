import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { AppContext } from '../app';

interface PublicFilter {
  id: string;
  slug: string;
  displayName: string;
  sourceName: string;
  description: string;
  parserVersion: number;
  parsed: unknown;
}
interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  filters: PublicFilter[];
}

export function registerPublicFilterRoutes(app: FastifyInstance, ctx: AppContext): void {
  const filters = ctx.db.repos.filters;

  app.get('/api/filters', async (req, reply) => {
    const rows = filters.listEnabled();
    const byCat = new Map<string, PublicCategory>();
    for (const r of rows) {
      let cat = byCat.get(r.category.id);
      if (!cat) {
        cat = { id: r.category.id, name: r.category.name, slug: r.category.slug, sortOrder: r.category.sortOrder, filters: [] };
        byCat.set(r.category.id, cat);
      }
      cat.filters.push({
        id: r.id,
        slug: r.slug,
        displayName: r.displayName,
        sourceName: r.sourceName,
        description: r.description,
        parserVersion: r.parserVersion,
        parsed: JSON.parse(r.parsedJson),
      });
    }
    const categories = [...byCat.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    const body = { categories };

    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)}"`;
    reply.header('etag', etag);
    reply.header('cache-control', 'private, max-age=60');
    if (req.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    return body;
  });
}
