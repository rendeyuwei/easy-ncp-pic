import { loadConfig } from './config';
import { initDb } from './db';
import { buildApp } from './app';
import { SessionService } from './auth/session';
import { seedInitialAdmin } from './seed';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = initDb(config.dbPath);
  await seedInitialAdmin(config, db.repos);
  const sessions = new SessionService(config, db.repos);
  const app = await buildApp({ config, db, sessions });
  // Listen on the local interface only; Nginx proxies /api in production (spec §14).
  await app.listen({ port: config.port, host: '127.0.0.1' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
