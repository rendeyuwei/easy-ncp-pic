import { describe, it, expect } from 'vitest';
import { randomToken, tokenHash, safeEqual } from '../src/auth/tokens';

describe('tokens', () => {
  it('randomToken returns hex of the requested byte length and is unique', () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('tokenHash is deterministic for the same secret+token', () => {
    expect(tokenHash('s', 'tok')).toBe(tokenHash('s', 'tok'));
  });

  it('tokenHash differs when the secret differs', () => {
    expect(tokenHash('s1', 'tok')).not.toBe(tokenHash('s2', 'tok'));
  });

  it('safeEqual is true for equal strings, false otherwise', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
