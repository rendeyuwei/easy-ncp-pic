import Database from 'better-sqlite3';

/**
 * Open a SQLite database with EasyPic's required pragmas:
 * WAL journal, foreign keys ON, and a busy timeout.
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}
