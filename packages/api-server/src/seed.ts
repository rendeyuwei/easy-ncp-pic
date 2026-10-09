import type { AppConfig } from './config';
import type { Repos } from './db';
import { hashPassword } from './auth/password';

/**
 * Create the initial admin from config if no admin exists yet (spec §14).
 *
 * With EASYPIC_ADMIN_RESET_PASSWORD=1 (exact) and a non-empty EASYPIC_ADMIN_PASSWORD,
 * startup instead forces that admin's password from the environment, revokes its
 * sessions, and warns loudly — this is a break-glass bootstrap for fresh installs
 * or lost passwords, not a steady state. Without the flag, behaviour is unchanged.
 */
export async function seedInitialAdmin(
  config: AppConfig,
  repos: Repos,
  log: (message: string) => void = (message) => console.warn(message),
): Promise<void> {
  const existing = repos.admins.findByUsername(config.adminUsername);

  if (config.adminResetPassword) {
    if (!config.adminPassword) {
      log(
        'EASYPIC_ADMIN_RESET_PASSWORD=1 is set but EASYPIC_ADMIN_PASSWORD is empty; ' +
          'skipping the bootstrap password reset.',
      );
    } else {
      const passwordHash = await hashPassword(config, config.adminPassword);
      const admin = existing
        ? repos.admins.updatePassword(existing.id, passwordHash)
        : repos.admins.create({ username: config.adminUsername, passwordHash });
      const revoked = admin ? repos.sessions.deleteByAdmin(admin.id) : 0;
      log(
        `SECURITY WARNING: EASYPIC_ADMIN_RESET_PASSWORD=1 reset the password for admin '${config.adminUsername}' ` +
          `from the environment and revoked ${revoked} session(s). ` +
          'Remove EASYPIC_ADMIN_RESET_PASSWORD from the environment now — while it is set, every restart ' +
          'overwrites passwords changed through the admin CLI.',
      );
      return;
    }
  }

  if (existing) return;
  if (!config.adminPassword) {
    throw new Error(
      `No admin '${config.adminUsername}' exists and EASYPIC_ADMIN_PASSWORD is not set; cannot seed the initial admin`,
    );
  }
  const passwordHash = await hashPassword(config, config.adminPassword);
  repos.admins.create({ username: config.adminUsername, passwordHash });
}
