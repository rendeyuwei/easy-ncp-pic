import { describe, it, expect } from 'vitest';
import { SCHEMA_VERSION } from '../src/index';

describe('smoke', () => {
  it('toolchain runs', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
});
