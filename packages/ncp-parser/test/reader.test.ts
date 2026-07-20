import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../src/reader';
import { NcpParseError } from '../src/errors';

const buf = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x41, 0x42]);

describe('BinaryReader', () => {
  it('reads uint8', () => {
    expect(new BinaryReader(buf).uint8(0)).toBe(0x01);
  });
  it('reads uint16 big-endian', () => {
    expect(new BinaryReader(buf).uint16BE(0)).toBe(0x0102);
  });
  it('reads uint32 big-endian', () => {
    expect(new BinaryReader(buf).uint32BE(0)).toBe(0x01020304);
  });
  it('reads ascii', () => {
    expect(new BinaryReader(buf).ascii(4, 2)).toBe('AB');
  });
  it('slices bytes', () => {
    expect(Array.from(new BinaryReader(buf).bytes(4, 2))).toEqual([0x41, 0x42]);
  });
  it('reports length', () => {
    expect(new BinaryReader(buf).length).toBe(6);
  });
  it('throws OUT_OF_BOUNDS when a read overruns the buffer', () => {
    const r = new BinaryReader(buf);
    let caught: NcpParseError | null = null;
    try {
      r.uint16BE(5);
    } catch (e) {
      caught = e as NcpParseError;
    }
    expect(caught).toBeInstanceOf(NcpParseError);
    expect(caught?.code).toBe('OUT_OF_BOUNDS');
  });
});
