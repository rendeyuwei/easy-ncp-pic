import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/connection';
import { migrate } from '../src/migrate';
import { AdminRepository } from '../src/admins';

let db: Database.Database;
let admins: AdminRepository;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  admins = new AdminRepository(db);
});
afterEach(() => db.close());

describe('AdminRepository', () => {
  it('creates an admin storing the password hash verbatim', () => {
    const a = admins.create({ username: 'admin', passwordHash: '$argon2id$...hash...' });
    expect(a.id).toBeTruthy();
    expect(a.username).toBe('admin');
    expect(a.passwordHash).toBe('$argon2id$...hash...');
    expect(a.createdAt).toBeTruthy();
    expect(a.passwordChangedAt).toBeTruthy();
  });
  it('enforces unique username', () => {
    admins.create({ username: 'admin', passwordHash: 'h1' });
    expect(() => admins.create({ username: 'admin', passwordHash: 'h2' })).toThrow();
  });
  it('findByUsername and findById', () => {
    const a = admins.create({ username: 'admin', passwordHash: 'h' });
    expect(admins.findByUsername('admin')?.id).toBe(a.id);
    expect(admins.findById(a.id)?.username).toBe('admin');
    expect(admins.findByUsername('nope')).toBeNull();
  });
  it('updatePassword changes hash and bumps password_changed_at', async () => {
    const a = admins.create({ username: 'admin', passwordHash: 'old' });
    await new Promise((r) => setTimeout(r, 5));
    const updated = admins.updatePassword(a.id, 'new');
    expect(updated?.passwordHash).toBe('new');
    expect(updated!.passwordChangedAt >= a.passwordChangedAt).toBe(true);
    expect(admins.updatePassword('nope', 'x')).toBeNull();
  });
});
