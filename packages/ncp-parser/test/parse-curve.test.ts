import { describe, it, expect } from 'vitest';
import { BinaryReader } from '../src/reader';
import { readCurve, readGamma, readControlPoints } from '../src/parse-curve';
import { buildNcp } from './helpers/build-ncp';
import { NcpParseError } from '../src/errors';

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as NcpParseError).code;
  }
}

describe('readGamma', () => {
  it('maps 0x00 to 1.00', () => {
    expect(readGamma(new BinaryReader(buildNcp({ gammaByte: 0x00 })))).toBeCloseTo(1.0, 6);
  });
  it('maps 0x0F to 1.15', () => {
    expect(readGamma(new BinaryReader(buildNcp({ gammaByte: 0x0f })))).toBeCloseTo(1.15, 6);
  });
});

describe('readControlPoints', () => {
  it('reads ordered points', () => {
    const pts = readControlPoints(new BinaryReader(buildNcp({ points: [[0, 0], [52, 53], [255, 255]] })));
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 52, y: 53 }, { x: 255, y: 255 }]);
  });
  it('rejects unordered points', () => {
    expect(codeOf(() => readControlPoints(new BinaryReader(buildNcp({ points: [[100, 0], [50, 53]] }))))).toBe(
      'UNORDERED_POINTS',
    );
  });
  it('rejects duplicate x values', () => {
    expect(codeOf(() => readControlPoints(new BinaryReader(buildNcp({ points: [[100, 0], [100, 53]] }))))).toBe(
      'UNORDERED_POINTS',
    );
  });
  it('rejects a point count exceeding the max', () => {
    expect(codeOf(() => readControlPoints(new BinaryReader(buildNcp({ pointCountByte: 28, points: [[0, 0]] }))))).toBe(
      'BAD_POINT_COUNT',
    );
  });
});

describe('readCurve', () => {
  it('reports enabled and embeds the 257-point LUT', () => {
    const c = readCurve(new BinaryReader(buildNcp({ curveEnabled: 1 })));
    expect(c.enabled).toBe(true);
    expect(c.lut257).toHaveLength(257);
    expect(c.gamma).toBeCloseTo(1.15, 6);
  });
  it('reports disabled when the flag is 0', () => {
    expect(readCurve(new BinaryReader(buildNcp({ curveEnabled: 0 }))).enabled).toBe(false);
  });
});
