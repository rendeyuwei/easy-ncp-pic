import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../src/reader';
import { readLut257 } from '../src/lut';
import { buildNcp } from './helpers/build-ncp';
import { LUT_COUNT, LUT_MAX } from '../src/constants';
import { NcpParseError } from '../src/errors';

describe('readLut257', () => {
  it('returns 257 normalized values in [0,1]', () => {
    const lut = readLut257(new BinaryReader(buildNcp()));
    expect(lut).toHaveLength(LUT_COUNT);
    expect(lut[0]).toBeCloseTo(0, 5);
    expect(lut[LUT_COUNT - 1]).toBeCloseTo(1, 5);
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('maps a raw value to raw/32767', () => {
    const raw = new Array(LUT_COUNT).fill(16383);
    const lut = readLut257(new BinaryReader(buildNcp({ lut: raw })));
    expect(lut[0]).toBeCloseTo(16383 / LUT_MAX, 6);
  });
  it('throws LUT_OUT_OF_RANGE when a value exceeds 32767', () => {
    const raw = new Array(LUT_COUNT).fill(0);
    raw[10] = 40000;
    let caught: NcpParseError | null = null;
    try {
      readLut257(new BinaryReader(buildNcp({ lut: raw })));
    } catch (e) {
      caught = e as NcpParseError;
    }
    expect(caught?.code).toBe('LUT_OUT_OF_RANGE');
    expect(caught).toBeInstanceOf(NcpParseError);
  });
});
