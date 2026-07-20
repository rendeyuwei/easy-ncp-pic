import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/connection';
import { migrate } from '../src/migrate';
import { CategoryRepository } from '../src/categories';
import { FilterRepository } from '../src/filters';

let db: Database.Database;
let categories: CategoryRepository;
let filters: FilterRepository;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  categories = new CategoryRepository(db);
  filters = new FilterRepository(db);
});
afterEach(() => db.close());

describe('transaction atomicity (spec §12 / §13.2)', () => {
  it('rolls back a multi-write transaction when a later write fails', () => {
    const catId = categories.create({ name: 'Film', slug: 'film' }).id;

    const work = db.transaction(() => {
      // First write succeeds:
      filters.create({
        displayName: 'Good',
        sourceName: 'Good',
        categoryId: catId,
        slug: 'good',
        ncpBlob: new Uint8Array([1]),
        ncpSha256: 'sha-good',
        parserVersion: 1,
        parsedJson: '{}',
      });
      // Second write fails (duplicate sha) -> whole transaction must roll back:
      filters.create({
        displayName: 'Bad',
        sourceName: 'Bad',
        categoryId: catId,
        slug: 'bad',
        ncpBlob: new Uint8Array([2]),
        ncpSha256: 'sha-good', // duplicate -> UNIQUE violation
        parserVersion: 1,
        parsedJson: '{}',
      });
    });

    expect(() => work()).toThrow();
    // Neither filter persisted:
    expect(filters.findBySlug('good')).toBeNull();
    expect(filters.findBySlug('bad')).toBeNull();
    expect(filters.listAll()).toHaveLength(0);
  });

  it('commits all writes when the transaction succeeds', () => {
    const work = db.transaction(() => {
      const c = categories.create({ name: 'Film', slug: 'film' });
      filters.create({
        displayName: 'A',
        sourceName: 'A',
        categoryId: c.id,
        slug: 'a',
        ncpBlob: new Uint8Array([1]),
        ncpSha256: 'sha-a',
        parserVersion: 1,
        parsedJson: '{}',
      });
    });
    expect(() => work()).not.toThrow();
    expect(filters.listAll()).toHaveLength(1);
    expect(categories.listAll()).toHaveLength(1);
  });
});
