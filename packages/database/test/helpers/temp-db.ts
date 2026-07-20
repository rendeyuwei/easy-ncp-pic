import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDatabase } from '../../src/connection';

export interface TempDb {
  path: string;
  db: Database.Database;
  close: () => void;
}

/** A real on-disk db in a fresh temp dir (WAL applies to file dbs). */
export function makeTempDb(): TempDb {
  const dir = mkdtempSync(join(tmpdir(), 'easypic-db-'));
  const path = join(dir, 'app.db');
  const db = openDatabase(path);
  return {
    path,
    db,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
