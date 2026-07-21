import type Database from 'better-sqlite3';
import { MIGRATIONS } from './migrations/index';

export interface Migration {
  version: number;
  name: string;
  /** One or more SQL statements applied atomically. */
  up: string;
}

/**
 * Apply any migrations whose version exceeds the db's current user_version,
 * in ascending version order. Each migration runs in its own transaction and
 * bumps user_version on success; a failure rolls back that migration fully.
 * Returns the resulting user_version.
 */
export function runMigrations(db: Database.Database, migrations: Migration[]): number {
  const current = db.pragma('user_version', { simple: true }) as number;
  const pending = migrations.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  for (const m of pending) {
    const apply = db.transaction(() => {
      db.exec(m.up);
      db.pragma(`user_version = ${m.version}`);
    });
    apply();
  }
  return db.pragma('user_version', { simple: true }) as number;
}

/** Apply the project's real migration list. */
export function migrate(db: Database.Database): number {
  return runMigrations(db, MIGRATIONS);
}
