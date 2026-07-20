import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../src/reader';
import { validateStructure } from '../src/validate';
import { buildNcp } from './helpers/build-ncp';
import { NcpParseError } from '../src/errors';

function codeOf(buf: Uint8Array): string | null {
  try {
    validateStructure(new BinaryReader(buf));
    return null;
  } catch (e) {
    return (e as NcpParseError).code;
  }
}

describe('validateStructure', () => {
  it('accepts a well-formed 638-byte buffer', () => {
    expect(() => validateStructure(new BinaryReader(buildNcp()))).not.toThrow();
  });
  it('rejects wrong length', () => {
    expect(codeOf(buildNcp({ length: 600 }))).toBe('BAD_LENGTH');
  });
  it('rejects a bad signature', () => {
    expect(codeOf(buildNcp({ signature: [0x58, 0x43, 0x50, 0x00] }))).toBe('BAD_SIGNATURE');
  });
  it('rejects an unsupported major version', () => {
    expect(codeOf(buildNcp({ majorVersion: 2 }))).toBe('BAD_VERSION');
  });
  it('rejects an unexpected header length', () => {
    expect(codeOf(buildNcp({ headerLength: 0x20 }))).toBe('BAD_HEADER');
  });
  it('rejects a bad ascii version', () => {
    expect(codeOf(buildNcp({ asciiVersion: '0200' }))).toBe('BAD_VERSION');
  });
});
