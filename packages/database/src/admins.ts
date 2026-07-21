import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AdminRecord } from './types';

const COLS = `id, username, password_hash, created_at, password_changed_at`;

function map(row: Record<string, unknown>): AdminRecord {
  return {
    id: row.id as string,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    createdAt: row.created_at as string,
    passwordChangedAt: row.password_changed_at as string,
  };
}

export class AdminRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: { username: string; passwordHash: string }): AdminRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO admins (id, username, password_hash) VALUES (@id, @username, @passwordHash)`,
      )
      .run({ id, username: input.username, passwordHash: input.passwordHash });
    return this.findById(id)!;
  }

  findById(id: string): AdminRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM admins WHERE id = ?`).get(id);
    return row ? map(row as Record<string, unknown>) : null;
  }

  findByUsername(username: string): AdminRecord | null {
    const row = this.db.prepare(`SELECT ${COLS} FROM admins WHERE username = ?`).get(username);
    return row ? map(row as Record<string, unknown>) : null;
  }

  updatePassword(id: string, passwordHash: string): AdminRecord | null {
    if (!this.findById(id)) return null;
    this.db
      .prepare(
        `UPDATE admins SET password_hash = @passwordHash,
           password_changed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = @id`,
      )
      .run({ id, passwordHash });
    return this.findById(id);
  }
}
