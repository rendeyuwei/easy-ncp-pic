import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb } from '../src/db';
import { SessionService } from '../src/auth/session';
import type { AppConfig } from '../src/config';

const config = {
  sessionSecret: 'test-secret',
  sessionTtlHours: 1,
} as unknown as AppConfig;

let db: ReturnType<typeof initDb>;
let sessions: SessionService;
let adminId: string;

beforeEach(() => {
  db = initDb(':memory:');
  adminId = db.repos.admins.create({ username: 'admin', passwordHash: 'x' }).id;
  sessions = new SessionService(config, db.repos);
});
afterEach(() => db.db.close());

describe('SessionService', () => {
  it('create stores a hashed token (not the raw token) and returns token + csrfToken', () => {
    const created = sessions.create(adminId);
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(created.expiresAt).toBeTruthy();
    // The raw token is NOT stored; only its HMAC hash is.
    const rows = db.db.prepare('SELECT token_hash FROM admin_sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(created.token);
  });

  it('findByToken resolves the session for the raw token only', () => {
    const created = sessions.create(adminId);
    expect(sessions.findByToken(created.token)?.adminId).toBe(adminId);
    expect(sessions.findByToken('deadbeef')).toBeNull();
  });

  it('isValid is true before expiry and false after', () => {
    const created = sessions.create(adminId);
    const session = sessions.findByToken(created.token)!;
    expect(sessions.isValid(session, new Date())).toBe(true);
    const future = new Date(Date.now() + 2 * 3600 * 1000); // beyond 1h TTL
    expect(sessions.isValid(session, future)).toBe(false);
  });

  it('revoke removes the session', () => {
    const created = sessions.create(adminId);
    const session = sessions.findByToken(created.token)!;
    sessions.revoke(session.id);
    expect(sessions.findByToken(created.token)).toBeNull();
  });
});
