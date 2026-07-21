import type { AdminSessionRecord } from '@easypic/database';
import type { AppConfig } from '../config';
import type { Repos } from '../db';
import { randomToken, tokenHash } from './tokens';

export interface CreatedSession {
  /** Raw token to place in the HttpOnly cookie. */
  token: string;
  /** CSRF secret to return to the client. */
  csrfToken: string;
  /** ISO expiry of the session. */
  expiresAt: string;
}

export class SessionService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repos,
  ) {}

  create(adminId: string): CreatedSession {
    const token = randomToken(32);
    const csrfToken = randomToken(32);
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600 * 1000).toISOString();
    this.repos.sessions.create({
      adminId,
      tokenHash: tokenHash(this.config.sessionSecret, token),
      csrfSecret: csrfToken,
      expiresAt,
    });
    return { token, csrfToken, expiresAt };
  }

  findByToken(token: string): AdminSessionRecord | null {
    return this.repos.sessions.findByTokenHash(tokenHash(this.config.sessionSecret, token));
  }

  isValid(session: AdminSessionRecord, now: Date = new Date()): boolean {
    return session.expiresAt > now.toISOString();
  }

  touch(id: string): void {
    this.repos.sessions.touch(id);
  }

  revoke(id: string): void {
    this.repos.sessions.delete(id);
  }
}
