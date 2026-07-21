import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, type Migration } from '../src/migrate';

function memDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}
function userVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}
function tableExists(db: Database.Database, name: string): boolean {
  const row = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
  return row !== undefined;
}

const M1: Migration = { version: 1, name: 'm1', up: `CREATE TABLE a (id INTEGER PRIMARY KEY);` };
const M2: Migration = { version: 2, name: 'm2', up: `CREATE TABLE b (id INTEGER PRIMARY KEY);` };

describe('runMigrations', () => {
  it('starts at user_version 0 and applies all pending in order', () => {
    const db = memDb();
    expect(userVersion(db)).toBe(0);
    const final = runMigrations(db, [M2, M1]); // passed out of order on purpose
    expect(final).toBe(2);
    expect(tableExists(db, 'a')).toBe(true);
    expect(tableExists(db, 'b')).toBe(true);
    db.close();
  });

  it('is idempotent (re-running applies nothing new)', () => {
    const db = memDb();
    runMigrations(db, [M1, M2]);
    const again = runMigrations(db, [M1, M2]);
    expect(again).toBe(2);
    db.close();
  });

  it('skips migrations already applied (user_version gate)', () => {
    const db = memDb();
    runMigrations(db, [M1]);
    // Now introduce M2; only it should run.
    const final = runMigrations(db, [M1, M2]);
    expect(final).toBe(2);
    expect(tableExists(db, 'b')).toBe(true);
    db.close();
  });

  it('rolls back a failing migration atomically (no partial schema, version unchanged)', () => {
    const db = memDb();
    runMigrations(db, [M1]);
    const bad: Migration = {
      version: 2,
      name: 'bad',
      up: `CREATE TABLE c (id INTEGER PRIMARY KEY); INSERT INTO nonexistent_table VALUES (1);`,
    };
    expect(() => runMigrations(db, [M1, bad])).toThrow();
    expect(userVersion(db)).toBe(1);
    expect(tableExists(db, 'c')).toBe(false); // rolled back
    db.close();
  });
});
