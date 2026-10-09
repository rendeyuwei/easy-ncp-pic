import process from 'node:process';
import { loadAdminCliConfig } from '../config';
import { initDb } from '../db';
import { ncpImportUsage, runNcpImportCli, type NcpImportIo } from '../ncp-import';

async function main(): Promise<number> {
  const io: NcpImportIo = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  };
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    // Answer help before requiring any environment.
    if (argv.length === 0) {
      io.stderr(ncpImportUsage());
      return 1;
    }
    io.stdout(ncpImportUsage());
    return 0;
  }
  const config = loadAdminCliConfig();
  const appDb = initDb(config.dbPath);
  try {
    return await runNcpImportCli(argv, io, { appDb });
  } finally {
    appDb.db.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
