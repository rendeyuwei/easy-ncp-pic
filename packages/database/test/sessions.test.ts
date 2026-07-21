import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase } from '../src/connection';
import { migrate } from '../src/migrate';
import { AdminRepository } from '../src/admins';
import { AdminSessionRepository, type NewSession } from '../src/sessions';

let db: Database.Database;
let sessions: AdminSessionRepository;
let adminId: string;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db);
  adminId = new AdminRepository(db).create({ username: 'admin', passwordHash: 'h' }).id;
  sessions = new AdminSessionRepository(db);
});
afterEach(() => db.close());

function newSession(over: Partial<NewSession> = {}): NewSession {
  const base: NewSession = {
    adminId,
    tokenHash: 'th-' + Math.random().toString(36).slice(2),
    csrfSecret: 'csrf-' + Math.random().toString(36).slice(2),
    expiresAt: '2030-01-01T00:00:00.000Z',
  };
  return { ...base, ...over };
}

describe('AdminSessionRepository', () => {
  it('creates a session storing only the token hash + csrf secret', () => {
    const s = sessions.create(newSession({ tokenHash: 'th1', csrfSecret: 'c1' }));
    expect(s.id).toBeTruthy();
    expect(s.adminId).toBe(adminId);
    expect(s.tokenHash).toBe('th1');
    expect(s.csrfSecret).toBe('c1');
    expect(s.expiresAt).toBe('2030-01-01T00:00:00.000Z');
    expect(s.createdAt).toBeTruthy();
    expect(s.lastSeenAt).toBeTruthy();
  });
  it('findByTokenHash and findById', () => {
    const s = sessions.create(newSession({ tokenHash: 'th1' }));
    expect(sessions.findByTokenHash('th1')?.id).toBe(s.id);
    expect(sessions.findById(s.id)?.tokenHash).toBe('th1');
    expect(sessions.findByTokenHash('nope')).toBeNull();
  });
  it('enforces unique token_hash', () => {
    sessions.create(newSession({ tokenHash: 'same' }));
    expect(() => sessions.create(newSession({ tokenHash: 'same' }))).toThrow();
  });
  it('touch updates last_seen_at', () => {
    const s = sessions.create(newSession());
    const touched = sessions.touch(s.id, '2031-05-05T05:05:05.000Z');
    expect(touched?.lastSeenAt).toBe('2031-05-05T05:05:05.000Z');
  });
  it('deleteExpired removes only expired sessions', () => {
    const expired = sessions.create(newSession({ expiresAt: '2000-01-01T00:00:00.000Z' }));
    const valid = sessions.create(newSession({ expiresAt: '2030-01-01T00:00:00.000Z' }));
    const removed = sessions.deleteExpired('2020-01-01T00:00:00.000Z');
    expect(removed).toBe(1);
    expect(sessions.findById(expired.id)).toBeNull();
    expect(sessions.findById(valid.id)).not.toBeNull();
  });
  it('delete and deleteByAdmin', () => {
    const s1 = sessions.create(newSession());
    const s2 = sessions.create(newSession());
    expect(sessions.delete(s1.id)).toBe(true);
    expect(sessions.findById(s1.id)).toBeNull();
    expect(sessions.deleteByAdmin(adminId)).toBe(1);
    expect(sessions.findById(s2.id)).toBeNull();
  });
  it('cascades when the admin is deleted', () => {
    const s = sessions.create(newSession());
    db.prepare(`DELETE FROM admins WHERE id = ?`).run(adminId);
    expect(sessions.findById(s.id)).toBeNull();
  });
});
