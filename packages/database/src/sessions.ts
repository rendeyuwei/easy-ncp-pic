import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AdminSessionRecord } from './types';

const COLS = `id, admin_id, token_hash, csrf_secret, expires_at, created_at, last_seen_at`;

function map(row: Record<string, unknown>): AdminSessionRecord {
  return {
    id: row.id as string,
    adminId: row.admin_id as string,
    tokenHash: row.token_hash as string,
    csrfSecret: row.csrf_secret as string,
    expiresAt: row.expires_at as string,
    createdAt: row.created_at as string,
    lastSeenAt: row.last_seen_at as string,
  };
}

export interface NewSession {
  adminId: string;
  tokenHash: string;
  csrfSecret: string;
  expiresAt: string;
}

export class AdminSessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: NewSession): AdminSessionRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO admin_sessions (id, admin_id, token_hash, csrf_secret, expires_at)
         VALUES (@id, @adminId, @tokenHash, @csrfSecret, @expiresAt)`,
      )
      .run({
        id,
        adminId: input.adminId,
        tokenHash: input.tokenHash,
        csrfSecret: input.csrfSecret,
        expiresAt: input.expiresAt,
      });
    return this.findById(id)!;
  }

  findById(id: string): AdminSessionRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM admin_sessions WHERE id = ?`).get(id);
    return row ? map(row as Record<string, unknown>) : null;
  }

  findByTokenHash(tokenHash: string): AdminSessionRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM admin_sessions WHERE token_hash = ?`).get(tokenHash);
    return row ? map(row as Record<string, unknown>) : null;
  }

  touch(id: string, nowIso?: string): AdminSessionRecord | null {
    if (!this.findById(id)) return null;
    const value = nowIso ?? new Date().toISOString();
    this.db.prepare(`UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?`).run(value, id);
    return this.findById(id);
  }

  deleteExpired(nowIso?: string): number {
    const value = nowIso ?? new Date().toISOString();
    return this.db.prepare(`DELETE FROM admin_sessions WHERE expires_at < ?`).run(value).changes;
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM admin_sessions WHERE id = ?`).run(id).changes > 0;
  }

  deleteByAdmin(adminId: string): number {
    return this.db.prepare(`DELETE FROM admin_sessions WHERE admin_id = ?`).run(adminId).changes;
  }
}
