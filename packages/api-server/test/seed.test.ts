import { describe, it, expect } from 'vitest';
import { seedInitialAdmin } from '../src/seed';
import { initDb } from '../src/db';
import { verifyPassword } from '../src/auth/password';
import { testConfig } from './helpers/build-test-app';

const RESET_PASSWORD = 'env-bootstrap-password-1';

async function seed(over: Parameters<typeof testConfig>[0] = {}) {
  const config = testConfig(over);
  const appDb = initDb(':memory:');
  const logs: string[] = [];
  await seedInitialAdmin(config, appDb.repos, (message) => logs.push(message));
  return { config, appDb, logs };
}

describe('seedInitialAdmin', () => {
  it('creates the admin once and never overwrites an existing password without the flag', async () => {
    const { config, appDb } = await seed();
    const admin = appDb.repos.admins.findByUsername('admin');
    expect(admin).not.toBeNull();
    expect(await verifyPassword(config, admin!.passwordHash, config.adminPassword)).toBe(true);

    appDb.repos.admins.updatePassword(admin!.id, 'manual-hash');
    await seedInitialAdmin(testConfig(), appDb.repos, () => {});
    expect(appDb.repos.admins.findByUsername('admin')!.passwordHash).toBe('manual-hash');
    appDb.db.close();
  });

  it('throws when no admin exists and no password is configured', async () => {
    const appDb = initDb(':memory:');
    await expect(seedInitialAdmin(testConfig({ adminPassword: '' }), appDb.repos, () => {})).rejects.toThrow(/EASYPIC_ADMIN_PASSWORD/);
    appDb.db.close();
  });

  it('with EASYPIC_ADMIN_RESET_PASSWORD=1 resets the existing admin and revokes its sessions', async () => {
    const appDb = initDb(':memory:');
    const config = testConfig();
    const created = appDb.repos.admins.create({ username: 'admin', passwordHash: 'forgotten-hash' });
    appDb.repos.sessions.create({
      adminId: created.id,
      tokenHash: 'tok-1',
      csrfSecret: 'csrf',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const other = appDb.repos.admins.create({ username: 'ops', passwordHash: 'ops-hash' });
    appDb.repos.sessions.create({
      adminId: other.id,
      tokenHash: 'tok-ops',
      csrfSecret: 'csrf',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const logs: string[] = [];
    const resetConfig = testConfig({ adminResetPassword: true, adminPassword: RESET_PASSWORD });
    await seedInitialAdmin(resetConfig, appDb.repos, (m) => logs.push(m));

    const admin = appDb.repos.admins.findByUsername('admin')!;
    expect(admin.passwordHash).not.toBe('forgotten-hash');
    expect(await verifyPassword(resetConfig, admin.passwordHash, RESET_PASSWORD)).toBe(true);
    expect(appDb.repos.sessions.findByTokenHash('tok-1')).toBeNull();
    expect(appDb.repos.sessions.findByTokenHash('tok-ops')).not.toBeNull();

    const warning = logs.join('\n');
    expect(warning).toContain('EASYPIC_ADMIN_RESET_PASSWORD');
    expect(warning).toMatch(/remove/i);
    expect(warning).toMatch(/1 session/);
    appDb.db.close();
  });

  it('with the flag but no admin yet, creates the admin from the environment password', async () => {
    const { config, appDb } = await seed({ adminResetPassword: true, adminPassword: RESET_PASSWORD });
    const admin = appDb.repos.admins.findByUsername('admin');
    expect(admin).not.toBeNull();
    expect(await verifyPassword(config, admin!.passwordHash, RESET_PASSWORD)).toBe(true);
    appDb.db.close();
  });

  it('with the flag but an empty password, leaves the existing admin untouched', async () => {
    const appDb = initDb(':memory:');
    appDb.repos.admins.create({ username: 'admin', passwordHash: 'keep-me' });
    const logs: string[] = [];
    await seedInitialAdmin(testConfig({ adminResetPassword: true, adminPassword: '' }), appDb.repos, (m) => logs.push(m));
    expect(appDb.repos.admins.findByUsername('admin')!.passwordHash).toBe('keep-me');
    expect(logs.join('\n')).toMatch(/skipping the bootstrap password reset/);
    appDb.db.close();
  });
});
