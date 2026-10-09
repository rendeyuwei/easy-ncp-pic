import { describe, it, expect } from 'vitest';
import { initDb, type AppDb } from '../src/db';
import { runAdminCli, MIN_PASSWORD_LENGTH, type AdminCliDeps, type AdminCliIo } from '../src/admin-cli';
import { verifyPassword } from '../src/auth/password';
import type { AdminCliConfig } from '../src/config';

const config: AdminCliConfig = { dbPath: ':memory:', argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 } };

interface FakeIo extends AdminCliIo {
  out: string[];
  err: string[];
}

function fakeIo(opts: { stdin?: string; tty?: boolean; prompts?: string[] } = {}): FakeIo {
  const out: string[] = [];
  const err: string[] = [];
  let promptIndex = 0;
  return {
    out,
    err,
    stdinIsTTY: opts.tty ?? false,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    readPasswordLine: async () => (opts.stdin ?? '').split('\n')[0]?.replace(/\r$/, '') ?? '',
    promptHidden: async () => opts.prompts?.[promptIndex++] ?? '',
  };
}

function fresh(): { deps: AdminCliDeps; appDb: AppDb } {
  const appDb = initDb(':memory:');
  return { deps: { config, repos: appDb.repos }, appDb };
}

function makeSession(appDb: AppDb, adminId: string, tokenHash: string): void {
  appDb.repos.sessions.create({
    adminId,
    tokenHash,
    csrfSecret: 'csrf',
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

const GOOD_PASSWORD = 'a-comfortably-long-password';

describe('admin cli: create', () => {
  it('creates an admin from --password-stdin and the hash verifies', async () => {
    const { deps, appDb } = fresh();
    const io = fakeIo({ stdin: `${GOOD_PASSWORD}\n` });
    expect(await runAdminCli(['create', 'ops', '--password-stdin'], io, deps)).toBe(0);
    const admin = appDb.repos.admins.findByUsername('ops');
    expect(admin).not.toBeNull();
    expect(await verifyPassword(config, admin!.passwordHash, GOOD_PASSWORD)).toBe(true);
    expect(io.out.join('\n')).toContain('Created admin');
    appDb.db.close();
  });

  it('prompts twice without echo on a TTY', async () => {
    const { deps, appDb } = fresh();
    const io = fakeIo({ tty: true, prompts: [GOOD_PASSWORD, GOOD_PASSWORD] });
    expect(await runAdminCli(['create', 'ops'], io, deps)).toBe(0);
    expect(appDb.repos.admins.findByUsername('ops')).not.toBeNull();
    appDb.db.close();
  });

  it('rejects mismatched prompts without creating anything', async () => {
    const { deps, appDb } = fresh();
    const io = fakeIo({ tty: true, prompts: [GOOD_PASSWORD, 'different-password-1'] });
    expect(await runAdminCli(['create', 'ops'], io, deps)).toBe(1);
    expect(io.err.join('\n')).toMatch(/do not match/i);
    expect(appDb.repos.admins.findByUsername('ops')).toBeNull();
    appDb.db.close();
  });

  it('refuses interactive prompts when stdin is not a TTY', async () => {
    const { deps } = fresh();
    const io = fakeIo({ tty: false });
    expect(await runAdminCli(['create', 'ops'], io, deps)).toBe(1);
    expect(io.err.join('\n')).toMatch(/--password-stdin|--generate/);
  });

  it('enforces the minimum length', async () => {
    const { deps, appDb } = fresh();
    const io = fakeIo({ stdin: 'short' });
    expect(await runAdminCli(['create', 'ops', '--password-stdin'], io, deps)).toBe(1);
    expect(io.err.join('\n')).toContain(String(MIN_PASSWORD_LENGTH));
    expect(appDb.repos.admins.findByUsername('ops')).toBeNull();
    appDb.db.close();
  });

  it('fails with exit code 2 when the admin already exists', async () => {
    const { deps, appDb } = fresh();
    appDb.repos.admins.create({ username: 'ops', passwordHash: 'old-hash' });
    const io = fakeIo({ stdin: GOOD_PASSWORD });
    expect(await runAdminCli(['create', 'ops', '--password-stdin'], io, deps)).toBe(2);
    expect(io.err.join('\n')).toMatch(/already exists/);
    expect(appDb.repos.admins.findByUsername('ops')!.passwordHash).toBe('old-hash');
    appDb.db.close();
  });
});

describe('admin cli: reset-password', () => {
  it('updates the hash and revokes all sessions for that admin', async () => {
    const { deps, appDb } = fresh();
    const admin = appDb.repos.admins.create({ username: 'admin', passwordHash: 'old-hash' });
    makeSession(appDb, admin.id, 'tok-a');
    makeSession(appDb, admin.id, 'tok-b');
    const other = appDb.repos.admins.create({ username: 'other', passwordHash: 'other-hash' });
    makeSession(appDb, other.id, 'tok-c');

    const io = fakeIo({ stdin: `${GOOD_PASSWORD}\n` });
    expect(await runAdminCli(['reset-password', 'admin', '--password-stdin'], io, deps)).toBe(0);

    const updated = appDb.repos.admins.findByUsername('admin')!;
    expect(updated.passwordHash).not.toBe('old-hash');
    expect(await verifyPassword(config, updated.passwordHash, GOOD_PASSWORD)).toBe(true);
    expect(appDb.repos.sessions.findByTokenHash('tok-a')).toBeNull();
    expect(appDb.repos.sessions.findByTokenHash('tok-b')).toBeNull();
    expect(appDb.repos.sessions.findByTokenHash('tok-c')).not.toBeNull(); // other admins untouched
    expect(io.out.join('\n')).toMatch(/Revoked 2/);
    appDb.db.close();
  });

  it('prints a generated password once that verifies against the stored hash', async () => {
    const { deps, appDb } = fresh();
    appDb.repos.admins.create({ username: 'admin', passwordHash: 'old-hash' });
    const io = fakeIo();
    expect(await runAdminCli(['reset-password', 'admin', '--generate'], io, deps)).toBe(0);

    const shown = io.out.find((line) => line.includes('Generated password'));
    expect(shown).toBeDefined();
    const password = shown!.split(': ')[1]!;
    expect(password.length).toBeGreaterThanOrEqual(20);
    expect(shown).toBe(io.out.find((l) => l.includes('Generated password'))); // printed exactly once
    expect(io.out.filter((l) => l.includes(password))).toHaveLength(1);
    const admin = appDb.repos.admins.findByUsername('admin')!;
    expect(await verifyPassword(config, admin.passwordHash, password)).toBe(true);
    appDb.db.close();
  });

  it('fails with exit code 2 and suggests create when the admin does not exist', async () => {
    const { deps } = fresh();
    const io = fakeIo({ stdin: GOOD_PASSWORD });
    expect(await runAdminCli(['reset-password', 'ghost', '--password-stdin'], io, deps)).toBe(2);
    expect(io.err.join('\n')).toMatch(/does not exist/);
    expect(io.err.join('\n')).toMatch(/admin create ghost/);
  });

  it('enforces the minimum length and leaves the hash untouched', async () => {
    const { deps, appDb } = fresh();
    appDb.repos.admins.create({ username: 'admin', passwordHash: 'old-hash' });
    const io = fakeIo({ stdin: 'too short' });
    expect(await runAdminCli(['reset-password', 'admin', '--password-stdin'], io, deps)).toBe(1);
    expect(appDb.repos.admins.findByUsername('admin')!.passwordHash).toBe('old-hash');
    appDb.db.close();
  });
});

describe('admin cli: list and usage', () => {
  it('lists usernames with timestamps but never hashes', async () => {
    const { deps, appDb } = fresh();
    const admin = appDb.repos.admins.create({ username: 'admin', passwordHash: 'super-secret-hash' });
    appDb.repos.admins.create({ username: 'ops', passwordHash: 'another-secret-hash' });
    const io = fakeIo();
    expect(await runAdminCli(['list'], io, deps)).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('admin');
    expect(text).toContain('ops');
    expect(text).toContain('created=');
    expect(text).toContain('password_changed=');
    expect(text).not.toContain('super-secret-hash');
    expect(text).not.toContain('another-secret-hash');
    expect(admin.username).toBe('admin');
    appDb.db.close();
  });

  it('reports an empty admin table', async () => {
    const { deps } = fresh();
    const io = fakeIo();
    expect(await runAdminCli(['list'], io, deps)).toBe(0);
    expect(io.out.join('\n')).toMatch(/No administrators/);
  });

  it.each([
    [['frobnicate']],
    [[]],
    [['reset-password']],
    [['reset-password', 'a', 'b']],
    [['create', 'ops', '--generate', '--password-stdin']],
    [['create', 'ops', '--password']],
    [['list', 'extra']],
  ])('returns exit code 1 for usage error %o', async (argv) => {
    const { deps } = fresh();
    const io = fakeIo({ stdin: GOOD_PASSWORD });
    expect(await runAdminCli(argv, io, deps)).toBe(1);
    expect(io.err.join('\n') + io.out.join('\n')).toMatch(/Usage/);
  });

  it('prints help with exit code 0', async () => {
    const { deps } = fresh();
    const io = fakeIo();
    expect(await runAdminCli(['--help'], io, deps)).toBe(0);
    expect(io.out.join('\n')).toMatch(/Usage: admin/);
  });
});
