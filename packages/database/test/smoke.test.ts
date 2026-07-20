import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

describe('smoke', () => {
  it('opens an in-memory SQLite database', () => {
    const db = new Database(':memory:');
    const row = db.prepare('SELECT 1 AS one').get() as { one: number };
    expect(row.one).toBe(1);
    db.close();
  });
});
