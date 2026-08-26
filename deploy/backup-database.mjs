import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { backupDatabase, openDatabase } from '/opt/easypic/current/packages/database/dist/index.js';

const [sourcePath, destinationPath] = process.argv.slice(2);
if (!sourcePath || !destinationPath) {
  throw new Error('Usage: backup-database.mjs <source> <destination>');
}

await mkdir(dirname(destinationPath), { recursive: true });
const db = openDatabase(sourcePath);
try {
  await backupDatabase(db, destinationPath);
} finally {
  db.close();
}
