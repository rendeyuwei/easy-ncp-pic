import {
  openDatabase,
  migrate,
  CategoryRepository,
  FilterRepository,
  AdminRepository,
  AdminSessionRepository,
} from '@easypic/database';

type Db = ReturnType<typeof openDatabase>;

export interface Repos {
  categories: CategoryRepository;
  filters: FilterRepository;
  admins: AdminRepository;
  sessions: AdminSessionRepository;
}

export interface AppDb {
  db: Db;
  repos: Repos;
}

/** Open the SQLite database, apply migrations, and build the repositories. */
export function initDb(path: string): AppDb {
  const db = openDatabase(path);
  migrate(db);
  return {
    db,
    repos: {
      categories: new CategoryRepository(db),
      filters: new FilterRepository(db),
      admins: new AdminRepository(db),
      sessions: new AdminSessionRepository(db),
    },
  };
}
