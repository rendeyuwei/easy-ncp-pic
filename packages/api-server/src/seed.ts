import type { AppConfig } from './config';
import type { Repos } from './db';
import { hashPassword } from './auth/password';

/** Create the initial admin from config if no admin exists yet (spec §14). */
export async function seedInitialAdmin(config: AppConfig, repos: Repos): Promise<void> {
  if (repos.admins.findByUsername(config.adminUsername)) return;
  if (!config.adminPassword) {
    throw new Error(
      `No admin '${config.adminUsername}' exists and EASYPIC_ADMIN_PASSWORD is not set; cannot seed the initial admin`,
    );
  }
  const passwordHash = await hashPassword(config, config.adminPassword);
  repos.admins.create({ username: config.adminUsername, passwordHash });
}
