import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../src/reader';
import { readName } from '../src/parse-name';
import { buildNcp } from './helpers/build-ncp';

describe('readName', () => {
  it('reads a NUL-terminated name', () => {
    expect(readName(new BinaryReader(buildNcp({ name: 'Fuji Astia' })))).toBe('Fuji Astia');
  });
  it('reads a full 20-byte name with no NUL', () => {
    const name = 'ABCDEFGHIJKLMNOPQRST'; // exactly 20 chars
    expect(readName(new BinaryReader(buildNcp({ name })))).toBe(name);
  });
  it('returns empty string for an empty name', () => {
    expect(readName(new BinaryReader(buildNcp({ name: '' })))).toBe('');
  });
});
