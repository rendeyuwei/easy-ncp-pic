import process from 'node:process';
import { loadAdminCliConfig } from '../config';
import { initDb } from '../db';
import { adminUsage, runAdminCli, type AdminCliIo } from '../admin-cli';

/** Read one line from piped stdin without readline's terminal handling. */
function readPasswordLine(): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setEncoding('utf8');
    let data = '';
    let settled = false;
    const done = (value: string) => {
      if (settled) return;
      settled = true;
      stdin.pause();
      resolve(value);
    };
    stdin.on('data', (chunk: string) => {
      data += chunk;
      const nl = data.indexOf('\n');
      if (nl !== -1) done(data.slice(0, nl).replace(/\r$/, ''));
    });
    stdin.on('end', () => done(data.replace(/\r$/, '')));
    stdin.on('error', () => done(data));
    stdin.resume();
  });
}

/** Ask for a password on a TTY with echo disabled (raw mode). Enter submits, Ctrl+C aborts. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    const isTTY = Boolean(stdin.isTTY);
    if (isTTY) stdin.setRawMode(true);
    let value = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      stdin.removeListener('data', onData);
      if (isTTY) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(value);
    };
    function onData(chunk: Buffer): void {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          finish();
          return;
        }
        const code = ch.charCodeAt(0);
        if (code === 3) {
          // Ctrl+C
          process.stdout.write('\n');
          process.exit(130);
        }
        if (code === 8 || code === 127) {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    }
    stdin.on('data', onData);
    stdin.resume();
  });
}

async function main(): Promise<number> {
  const io: AdminCliIo = {
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
    stdinIsTTY: Boolean(process.stdin.isTTY),
    readPasswordLine,
    promptHidden,
  };
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    // Answer help before requiring any environment.
    if (argv.length === 0) {
      io.stderr(adminUsage());
      return 1;
    }
    io.stdout(adminUsage());
    return 0;
  }
  const config = loadAdminCliConfig();
  const appDb = initDb(config.dbPath);
  try {
    return await runAdminCli(argv, io, { config, repos: appDb.repos });
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