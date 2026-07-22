import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import type { AppConfig } from '../src/config';

const config = {
  env: 'test',
  argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 },
} as unknown as AppConfig;

describe('password (Argon2id)', () => {
  it('hashes to an argon2id PHC string and verifies the correct password', async () => {
    const hash = await hashPassword(config, 'correct horse');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(config, hash, 'correct horse')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(config, 'right');
    expect(await verifyPassword(config, hash, 'wrong')).toBe(false);
  });

  it('produces different hashes for the same password (salted)', async () => {
    const a = await hashPassword(config, 'same');
    const b = await hashPassword(config, 'same');
    expect(a).not.toBe(b);
  });
});
