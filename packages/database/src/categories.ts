import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { makeSlug } from './slug';
import type { CategoryRecord, NewCategory, CategoryPatch } from './types';

const COLS = `id, name, slug, sort_order, is_enabled`;

function map(row: Record<string, unknown>): CategoryRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    sortOrder: row.sort_order as number,
    isEnabled: (row.is_enabled as number) === 1,
  };
}

export class CategoryRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: NewCategory): CategoryRecord {
    const id = randomUUID();
    const slug = input.slug ?? makeSlug(input.name);
    this.db
      .prepare(
        `INSERT INTO filter_categories (id, name, slug, sort_order, is_enabled)
         VALUES (@id, @name, @slug, @sortOrder, @isEnabled)`,
      )
      .run({
        id,
        name: input.name,
        slug,
        sortOrder: input.sortOrder ?? 0,
        isEnabled: (input.isEnabled ?? true) ? 1 : 0,
      });
    return this.findById(id)!;
  }

  findById(id: string): CategoryRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM filter_categories WHERE id = ?`).get(id);
    return row ? map(row as Record<string, unknown>) : null;
  }

  findBySlug(slug: string): CategoryRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM filter_categories WHERE slug = ?`).get(slug);
    return row ? map(row as Record<string, unknown>) : null;
  }

  listAll(): CategoryRecord[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM filter_categories ORDER BY sort_order ASC, name ASC`)
      .all()
      .map((r) => map(r as Record<string, unknown>));
  }

  listEnabled(): CategoryRecord[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM filter_categories WHERE is_enabled = 1 ORDER BY sort_order ASC, name ASC`)
      .all()
      .map((r) => map(r as Record<string, unknown>));
  }

  update(id: string, patch: CategoryPatch): CategoryRecord | null {
    if (!this.findById(id)) return null;
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (patch.name !== undefined) {
      sets.push('name = @name');
      params.name = patch.name;
    }
    if (patch.slug !== undefined) {
      sets.push('slug = @slug');
      params.slug = patch.slug;
    }
    if (patch.sortOrder !== undefined) {
      sets.push('sort_order = @sortOrder');
      params.sortOrder = patch.sortOrder;
    }
    if (patch.isEnabled !== undefined) {
      sets.push('is_enabled = @isEnabled');
      params.isEnabled = patch.isEnabled ? 1 : 0;
    }
    if (sets.length > 0) {
      this.db.prepare(`UPDATE filter_categories SET ${sets.join(', ')} WHERE id = @id`).run(params);
    }
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM filter_categories WHERE id = ?`).run(id).changes > 0;
  }
}
