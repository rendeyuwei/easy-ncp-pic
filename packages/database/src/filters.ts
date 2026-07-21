import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { makeSlug } from './slug';
import type { FilterRecord, FilterWithCategory, NewFilter, FilterPatch, CategoryRecord } from './types';

const COLS = `id, slug, display_name, source_name, description, category_id, sort_order,
  is_enabled, ncp_sha256, parser_version, parsed_json, created_at, updated_at`;

function map(row: Record<string, unknown>): FilterRecord {
  return {
    id: row.id as string,
    slug: row.slug as string,
    displayName: row.display_name as string,
    sourceName: row.source_name as string,
    description: row.description as string,
    categoryId: row.category_id as string,
    sortOrder: row.sort_order as number,
    isEnabled: (row.is_enabled as number) === 1,
    ncpSha256: row.ncp_sha256 as string,
    parserVersion: row.parser_version as number,
    parsedJson: row.parsed_json as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapCategoryPrefixed(row: Record<string, unknown>): CategoryRecord {
  return {
    id: row.c_id as string,
    name: row.c_name as string,
    slug: row.c_slug as string,
    sortOrder: row.c_sort_order as number,
    isEnabled: (row.c_is_enabled as number) === 1,
  };
}

export class FilterRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: NewFilter): FilterRecord {
    const id = randomUUID();
    const slug = input.slug ?? makeSlug(input.displayName);
    this.db
      .prepare(
        `INSERT INTO filters
           (id, slug, display_name, source_name, description, category_id, sort_order,
            is_enabled, ncp_blob, ncp_sha256, parser_version, parsed_json)
         VALUES
           (@id, @slug, @displayName, @sourceName, @description, @categoryId, @sortOrder,
            @isEnabled, @ncpBlob, @ncpSha256, @parserVersion, @parsedJson)`,
      )
      .run({
        id,
        slug,
        displayName: input.displayName,
        sourceName: input.sourceName,
        description: input.description ?? '',
        categoryId: input.categoryId,
        sortOrder: input.sortOrder ?? 0,
        isEnabled: (input.isEnabled ?? true) ? 1 : 0,
        ncpBlob: Buffer.from(input.ncpBlob),
        ncpSha256: input.ncpSha256,
        parserVersion: input.parserVersion,
        parsedJson: input.parsedJson,
      });
    return this.findById(id)!;
  }

  findById(id: string): FilterRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM filters WHERE id = ?`).get(id);
    return row ? map(row as Record<string, unknown>) : null;
  }

  findBySlug(slug: string): FilterRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM filters WHERE slug = ?`).get(slug);
    return row ? map(row as Record<string, unknown>) : null;
  }

  findBySha256(sha256: string): FilterRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM filters WHERE ncp_sha256 = ?`).get(sha256);
    return row ? map(row as Record<string, unknown>) : null;
  }

  listAll(): FilterRecord[] {
    return this.db
      .prepare(`SELECT ${COLS} FROM filters ORDER BY sort_order ASC, display_name ASC`)
      .all()
      .map((r) => map(r as Record<string, unknown>));
  }

  listEnabled(): FilterWithCategory[] {
    const rows = this.db
      .prepare(
        `SELECT f.id, f.slug, f.display_name, f.source_name, f.description, f.category_id,
                f.sort_order, f.is_enabled, f.ncp_sha256, f.parser_version, f.parsed_json,
                f.created_at, f.updated_at,
                c.id AS c_id, c.name AS c_name, c.slug AS c_slug,
                c.sort_order AS c_sort_order, c.is_enabled AS c_is_enabled
         FROM filters f
         JOIN filter_categories c ON c.id = f.category_id
         WHERE f.is_enabled = 1 AND c.is_enabled = 1
         ORDER BY c.sort_order ASC, f.sort_order ASC, f.display_name ASC`,
      )
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({ ...map(r), category: mapCategoryPrefixed(r) }));
  }

  update(id: string, patch: FilterPatch): FilterRecord | null {
    if (!this.findById(id)) return null;
    const sets: string[] = [];
    const params: Record<string, unknown> = { id };
    if (patch.displayName !== undefined) {
      sets.push('display_name = @displayName');
      params.displayName = patch.displayName;
    }
    if (patch.description !== undefined) {
      sets.push('description = @description');
      params.description = patch.description;
    }
    if (patch.categoryId !== undefined) {
      sets.push('category_id = @categoryId');
      params.categoryId = patch.categoryId;
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
    sets.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
    this.db.prepare(`UPDATE filters SET ${sets.join(', ')} WHERE id = @id`).run(params);
    return this.findById(id);
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM filters WHERE id = ?`).run(id).changes > 0;
  }

  getNcpBlob(id: string): Uint8Array | null {
    const row = this.db.prepare(`SELECT ncp_blob FROM filters WHERE id = ?`).get(id) as
      | { ncp_blob: Buffer }
      | undefined;
    return row ? new Uint8Array(row.ncp_blob) : null;
  }
}
