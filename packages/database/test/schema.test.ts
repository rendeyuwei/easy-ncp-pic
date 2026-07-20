import { describe, it, expect, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/connection';
import { migrate } from '../src/migrate';

let db: Database.Database | null = null;
afterEach(() => {
  db?.close();
  db = null;
});

function migrated(): Database.Database {
  db = openDatabase(':memory:');
  migrate(db);
  return db;
}
function tables(d: Database.Database): string[] {
  return d
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => (r as { name: string }).name);
}
function columns(d: Database.Database, table: string): string[] {
  return d.prepare(`PRAGMA table_info(${table})`).all().map((r) => (r as { name: string }).name);
}

describe('0001_init schema', () => {
  it('creates the four tables', () => {
    const d = migrated();
    const t = tables(d);
    for (const name of ['admins', 'admin_sessions', 'filter_categories', 'filters']) {
      expect(t).toContain(name);
    }
  });
  it('filters has all spec §7.2 columns', () => {
    const d = migrated();
    expect(columns(d, 'filters')).toEqual(
      expect.arrayContaining([
        'id', 'slug', 'display_name', 'source_name', 'description', 'category_id',
        'sort_order', 'is_enabled', 'ncp_blob', 'ncp_sha256', 'parser_version',
        'parsed_json', 'created_at', 'updated_at',
      ]),
    );
  });
  it('admin_sessions has all spec §7.3 columns', () => {
    const d = migrated();
    expect(columns(d, 'admin_sessions')).toEqual(
      expect.arrayContaining(['id', 'admin_id', 'token_hash', 'csrf_secret', 'expires_at', 'created_at', 'last_seen_at']),
    );
  });
  it('sets user_version to 1', () => {
    const d = migrated();
    expect(d.pragma('user_version', { simple: true })).toBe(1);
  });
  it('enforces the filters.category_id foreign key', () => {
    const d = migrated();
    expect(() =>
      d
        .prepare(
          `INSERT INTO filters (id, slug, display_name, source_name, category_id, ncp_blob, ncp_sha256, parser_version, parsed_json)
           VALUES ('f1','s1','n','src','missing-cat', X'00', 'sha-a', 1, '{}')`,
        )
        .run(),
    ).toThrow();
  });
  it('enforces unique ncp_sha256', () => {
    const d = migrated();
    d.prepare(`INSERT INTO filter_categories (id, name, slug) VALUES ('c1','Cat','cat')`).run();
    const ins = d.prepare(
      `INSERT INTO filters (id, slug, display_name, source_name, category_id, ncp_blob, ncp_sha256, parser_version, parsed_json)
       VALUES (?, ?, 'n','src','c1', X'00', 'dup-sha', 1, '{}')`,
    );
    ins.run('f1', 's1');
    expect(() => ins.run('f2', 's2')).toThrow();
  });
});
