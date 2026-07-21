import type Database from 'better-sqlite3';

/**
 * Take a consistent on-disk snapshot of the database using better-sqlite3's
 * online backup API (safe even while the db is in use; spec §14).
 */
export async function backupDatabase(db: Database.Database, destPath: string): Promise<void> {
  await db.backup(destPath);
}
