import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/connection';
import { migrate } from '../src/migrate';
import { CategoryRepository } from '../src/categories';
import { FilterRepository } from '../src/filters';
import type { NewFilter } from '../src/types';

let db: Database.Database;
let categories: CategoryRepository;
let filters: FilterRepository;
let catId: string;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  categories = new CategoryRepository(db);
  filters = new FilterRepository(db);
  catId = categories.create({ name: 'Film', slug: 'film' }).id;
});
afterEach(() => db.close());

function newFilter(over: Partial<NewFilter> = {}): NewFilter {
  const base: NewFilter = {
    displayName: 'Fuji Astia',
    sourceName: 'Fuji Astia',
    description: 'd',
    categoryId: catId,
    ncpBlob: new Uint8Array([1, 2, 3]),
    ncpSha256: 'sha-' + Math.random().toString(36).slice(2),
    parserVersion: 1,
    parsedJson: '{"schemaVersion":1}',
  };
  return { ...base, ...over };
}

describe('FilterRepository', () => {
  it('creates a filter, storing blob + parsed JSON together', () => {
    const f = filters.create(newFilter({ ncpSha256: 'sha-x', slug: 'astia' }));
    expect(f.id).toBeTruthy();
    expect(f.slug).toBe('astia');
    expect(f.displayName).toBe('Fuji Astia');
    expect(f.sourceName).toBe('Fuji Astia');
    expect(f.categoryId).toBe(catId);
    expect(f.isEnabled).toBe(true);
    expect(f.parserVersion).toBe(1);
    expect(f.parsedJson).toBe('{"schemaVersion":1}');
    expect(f.createdAt).toBeTruthy();
    expect(f.updatedAt).toBeTruthy();
    expect(filters.getNcpBlob(f.id)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('reads exclude the blob by default', () => {
    const f = filters.create(newFilter());
    const read = filters.findById(f.id)!;
    expect('ncpBlob' in read).toBe(false);
  });

  it('findBySha256 supports dedup', () => {
    const f = filters.create(newFilter({ ncpSha256: 'dup' }));
    expect(filters.findBySha256('dup')?.id).toBe(f.id);
    expect(filters.findBySha256('nope')).toBeNull();
  });

  it('rejects a duplicate ncp_sha256 at the DB level', () => {
    filters.create(newFilter({ ncpSha256: 'same', slug: 'a' }));
    expect(() => filters.create(newFilter({ ncpSha256: 'same', slug: 'b' }))).toThrow();
  });

  it('findBySlug', () => {
    const f = filters.create(newFilter({ slug: 'astia' }));
    expect(filters.findBySlug('astia')?.id).toBe(f.id);
  });

  it('listEnabled joins category, filters disabled, and orders by category then filter sort', () => {
    const cat2 = categories.create({ name: 'Other', slug: 'other', sortOrder: 0 });
    categories.update(catId, { sortOrder: 1 }); // Film sorts after Other
    filters.create(newFilter({ displayName: 'F1', slug: 'f1', categoryId: catId, sortOrder: 0 }));
    filters.create(newFilter({ displayName: 'O1', slug: 'o1', categoryId: cat2.id, sortOrder: 5 }));
    filters.create(newFilter({ displayName: 'Off', slug: 'off', categoryId: cat2.id, isEnabled: false }));
    const list = filters.listEnabled();
    expect(list.map((f) => f.slug)).toEqual(['o1', 'f1']);
    expect(list[0].category.slug).toBe('other');
    expect(list[1].category.slug).toBe('film');
  });

  it('listEnabled excludes filters whose category is disabled', () => {
    filters.create(newFilter({ slug: 'f1' }));
    categories.update(catId, { isEnabled: false });
    expect(filters.listEnabled()).toHaveLength(0);
    expect(filters.listAll()).toHaveLength(1);
  });

  it('update bumps updated_at and changes fields', async () => {
    const f = filters.create(newFilter({ slug: 'f1', displayName: 'Before' }));
    await new Promise((r) => setTimeout(r, 5)); // ensure a different timestamp
    const updated = filters.update(f.id, { displayName: 'After', isEnabled: false, sortOrder: 3 });
    expect(updated?.displayName).toBe('After');
    expect(updated?.isEnabled).toBe(false);
    expect(updated?.sortOrder).toBe(3);
    expect(updated!.updatedAt >= f.updatedAt).toBe(true);
    expect(filters.update('nope', { displayName: 'x' })).toBeNull();
  });

  it('delete removes and getNcpBlob returns null after', () => {
    const f = filters.create(newFilter());
    expect(filters.delete(f.id)).toBe(true);
    expect(filters.findById(f.id)).toBeNull();
    expect(filters.getNcpBlob(f.id)).toBeNull();
    expect(filters.delete('nope')).toBe(false);
  });
});
