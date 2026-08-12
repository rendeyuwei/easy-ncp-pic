import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionService,
  buildApp,
  initDb,
  seedInitialAdmin,
} from '../../api-server/dist/index.js';

const tempDirectory = mkdtempSync(join(tmpdir(), 'easypic-admin-e2e-'));
const config = {
  env: 'test',
  port: 3001,
  dbPath: join(tempDirectory, 'easypic.sqlite'),
  sessionSecret: 'easypic-admin-e2e-session-secret',
  sessionTtlHours: 12,
  cookieSecure: false,
  adminUsername: 'admin',
  adminPassword: 'admin-e2e-password',
  argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 },
  loginRateLimit: { max: 1000, timeWindow: '1 minute' },
};

let db;
let app;
let cleanupPromise;

function cleanup() {
  cleanupPromise ??= (async () => {
    try {
      if (app) {
        app.server.closeAllConnections();
        await app.close();
      }
    } finally {
      try {
        db?.db.close();
      } finally {
        rmSync(tempDirectory, { recursive: true, force: true });
      }
    }
  })();
  return cleanupPromise;
}

function requestShutdown() {
  void cleanup().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

process.once('SIGINT', requestShutdown);
process.once('SIGTERM', requestShutdown);
process.once('SIGHUP', requestShutdown);
process.once('beforeExit', requestShutdown);

try {
  db = initDb(config.dbPath);
  await seedInitialAdmin(config, db.repos);
  const sessions = new SessionService(config, db.repos);
  app = await buildApp({ config, db, sessions });
  await app.listen({ port: config.port, host: '127.0.0.1' });
} catch (error) {
  console.error(error);
  process.exitCode = 1;
  await cleanup();
}
