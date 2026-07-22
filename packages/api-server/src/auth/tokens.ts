import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/** A cryptographically-random hex token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** HMAC-SHA256 hex of a token under the session secret. */
export function tokenHash(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** Constant-time string equality. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
