import { openDatabase } from '../connection';
import { migrate } from '../migrate';

const path = process.argv[2] ?? process.env.EASYPIC_DB;
if (!path) {
  console.error('Usage: easypic-migrate <db-file>   (or set EASYPIC_DB)');
  process.exit(1);
}
const db = openDatabase(path);
const version = migrate(db);
console.log(`migrated ${path} -> user_version ${version}`);
db.close();
