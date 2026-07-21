import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase } from '../src/connection';
import { makeTempDb } from './helpers/temp-db';

describe('openDatabase', () => {
  it('enables foreign_keys', () => {
    const db = openDatabase(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.close();
  });
  it('uses WAL journal mode on a file db', () => {
    const t = makeTempDb();
    expect(t.db.pragma('journal_mode', { simple: true })).toBe('wal');
    t.close();
  });
  it('sets a busy_timeout', () => {
    const db = openDatabase(':memory:');
    expect(Number(db.pragma('busy_timeout', { simple: true }))).toBeGreaterThan(0);
    db.close();
  });
});
