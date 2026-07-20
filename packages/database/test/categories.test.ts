import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/connection';
import { migrate } from '../src/migrate';
import { CategoryRepository } from '../src/categories';

let db: Database.Database;
let repo: CategoryRepository;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  repo = new CategoryRepository(db);
});
afterEach(() => db.close());

describe('CategoryRepository', () => {
  it('creates a category with a generated id and slug', () => {
    const c = repo.create({ name: 'Film' });
    expect(c.id).toBeTruthy();
    expect(c.slug).toBe('film');
    expect(c.name).toBe('Film');
    expect(c.sortOrder).toBe(0);
    expect(c.isEnabled).toBe(true);
  });
  it('generates a fallback slug for non-latin names', () => {
    const c = repo.create({ name: '风景' });
    expect(c.slug).toMatch(/^[a-z0-9]{8}$/);
  });
  it('respects explicit slug/sortOrder/isEnabled', () => {
    const c = repo.create({ name: 'X', slug: 'custom', sortOrder: 5, isEnabled: false });
    expect(c.slug).toBe('custom');
    expect(c.sortOrder).toBe(5);
    expect(c.isEnabled).toBe(false);
  });
  it('findById and findBySlug', () => {
    const c = repo.create({ name: 'Film' });
    expect(repo.findById(c.id)?.name).toBe('Film');
    expect(repo.findBySlug('film')?.id).toBe(c.id);
    expect(repo.findById('nope')).toBeNull();
  });
  it('listAll orders by sort_order then name; listEnabled filters', () => {
    repo.create({ name: 'B', slug: 'b', sortOrder: 2 });
    repo.create({ name: 'A', slug: 'a', sortOrder: 2 });
    repo.create({ name: 'Hidden', slug: 'h', sortOrder: 1, isEnabled: false });
    expect(repo.listAll().map((c) => c.slug)).toEqual(['h', 'a', 'b']);
    expect(repo.listEnabled().map((c) => c.slug)).toEqual(['a', 'b']);
  });
  it('updates fields', () => {
    const c = repo.create({ name: 'Film' });
    const updated = repo.update(c.id, { name: 'Cinema', sortOrder: 9, isEnabled: false });
    expect(updated?.name).toBe('Cinema');
    expect(updated?.sortOrder).toBe(9);
    expect(updated?.isEnabled).toBe(false);
    expect(repo.update('nope', { name: 'x' })).toBeNull();
  });
  it('deletes a category with no filters', () => {
    const c = repo.create({ name: 'Film' });
    expect(repo.delete(c.id)).toBe(true);
    expect(repo.findById(c.id)).toBeNull();
    expect(repo.delete('nope')).toBe(false);
  });
});
