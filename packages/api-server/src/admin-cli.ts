import { randomBytes } from 'node:crypto';
import type { AdminCliConfig } from './config';
import type { Repos } from './db';
import { hashPassword } from './auth/password';

export const MIN_PASSWORD_LENGTH = 12;

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_NOT_FOUND = 2;

/** Everything the CLI touches outside the database, injected so tests can fake the terminal. */
export interface AdminCliIo {
  stdout(line: string): void;
  stderr(line: string): void;
  readonly stdinIsTTY: boolean;
  /** Read one password line from piped stdin (--password-stdin). */
  readPasswordLine(): Promise<string>;
  /** Prompt on a TTY without echoing the typed password. */
  promptHidden(question: string): Promise<string>;
}

export interface AdminCliDeps {
  config: AdminCliConfig;
  repos: Repos;
}

export function adminUsage(): string {
  return [
    'Usage: admin <command> [...]',
    '',
    'Commands:',
    '  list                                  Show usernames with created_at / password_changed_at (no hashes).',
    '  create <username> [password options]  Add a new administrator.',
    '  reset-password <username> [options]   Replace an existing administrator\'s password and revoke',
    '                                        all of its sessions.',
    '',
    'Password options (create / reset-password):',
    '  (none)            Prompt twice without echo — requires an interactive terminal.',
    '  --password-stdin  Read one password line from stdin (pipe or heredoc).',
    '  --generate        Generate a strong random password and print it exactly once.',
    '',
    `Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    'Exit codes: 0 ok, 1 usage/validation error, 2 not found / conflict.',
  ].join('\n');
}

/** >=20 url-safe characters from 24 random bytes (base64url, no padding). */
export function generateAdminPassword(): string {
  return randomBytes(24).toString('base64url');
}

interface ParsedArgs {
  username: string;
  generate: boolean;
  passwordStdin: boolean;
}

function parsePasswordArgs(rest: string[]): ParsedArgs | string {
  let username = '';
  let generate = false;
  let passwordStdin = false;
  for (const arg of rest) {
    if (arg === '--generate') {
      generate = true;
      continue;
    }
    if (arg === '--password-stdin') {
      passwordStdin = true;
      continue;
    }
    if (arg.startsWith('-')) return `Unknown option: ${arg}`;
    if (username) return 'Too many arguments; expected exactly one username.';
    username = arg.trim();
  }
  if (!username) return 'Missing <username>.';
  if (generate && passwordStdin) return 'Choose only one of --generate and --password-stdin.';
  return { username, generate, passwordStdin };
}

/** Returns the password, or null after writing its own error to io. */
async function resolvePassword(
  username: string,
  args: ParsedArgs,
  io: AdminCliIo,
): Promise<string | null> {
  if (args.generate) {
    const password = generateAdminPassword();
    io.stdout(`Generated password for '${username}': ${password}`);
    io.stdout('Copy it now — it is shown only once and is not stored anywhere else.');
    return password;
  }
  if (args.passwordStdin) {
    const line = await io.readPasswordLine();
    return line.replace(/\r$/, '');
  }
  if (!io.stdinIsTTY) {
    io.stderr('stdin is not an interactive terminal; supply the password with --password-stdin or use --generate.');
    return null;
  }
  const first = await io.promptHidden(`New password for '${username}' (min ${MIN_PASSWORD_LENGTH} chars): `);
  const second = await io.promptHidden('Repeat password: ');
  if (first !== second) {
    io.stderr('The two passwords do not match; nothing was changed.');
    return null;
  }
  return first;
}

export async function runAdminCli(argv: string[], io: AdminCliIo, deps: AdminCliDeps): Promise<number> {
  const [command, ...rest] = argv;

  if (!command) {
    io.stderr(adminUsage());
    return EXIT_USAGE;
  }
  if (command === '--help' || command === '-h') {
    io.stdout(adminUsage());
    return EXIT_OK;
  }

  if (command === 'list') {
    if (rest.length > 0) {
      io.stderr(`'list' takes no arguments.`);
      io.stderr(adminUsage());
      return EXIT_USAGE;
    }
    const admins = deps.repos.admins.listAll();
    if (admins.length === 0) {
      io.stdout('No administrators found.');
      return EXIT_OK;
    }
    for (const admin of admins) {
      io.stdout(`${admin.username}\tcreated=${admin.createdAt}\tpassword_changed=${admin.passwordChangedAt}`);
    }
    return EXIT_OK;
  }

  if (command !== 'create' && command !== 'reset-password') {
    io.stderr(`Unknown command: ${command}`);
    io.stderr(adminUsage());
    return EXIT_USAGE;
  }

  const args = parsePasswordArgs(rest);
  if (typeof args === 'string') {
    io.stderr(args);
    io.stderr(adminUsage());
    return EXIT_USAGE;
  }

  let target: { id: string } | null = null;
  if (command === 'create') {
    if (deps.repos.admins.findByUsername(args.username)) {
      io.stderr(`Admin '${args.username}' already exists. To change its password use: admin reset-password ${args.username}`);
      return EXIT_NOT_FOUND;
    }
  } else {
    target = deps.repos.admins.findByUsername(args.username);
    if (!target) {
      io.stderr(`Admin '${args.username}' does not exist. Create it with: admin create ${args.username}`);
      return EXIT_NOT_FOUND;
    }
  }

  const password = await resolvePassword(args.username, args, io);
  if (password === null) return EXIT_USAGE;
  if (password.length < MIN_PASSWORD_LENGTH) {
    io.stderr(`Password is too short: at least ${MIN_PASSWORD_LENGTH} characters are required. Nothing was changed.`);
    return EXIT_USAGE;
  }

  const passwordHash = await hashPassword(deps.config, password);
  const admin =
    command === 'create'
      ? deps.repos.admins.create({ username: args.username, passwordHash })
      : deps.repos.admins.updatePassword(target!.id, passwordHash)!;
  const revoked = deps.repos.sessions.deleteByAdmin(admin.id);
  if (command === 'create') {
    io.stdout(`Created admin '${args.username}'.`);
  } else {
    io.stdout(`Password updated for '${args.username}'.`);
  }
  io.stdout(`Revoked ${revoked} session(s); every browser session of this admin must log in again.`);
  return EXIT_OK;
}
