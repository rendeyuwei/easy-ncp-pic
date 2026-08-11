import { describe, it, expect } from 'vitest';
import { CurveLut } from '../src/curve';

describe('CurveLut', () => {
  it('identity maps every value to itself', () => {
    const lut = CurveLut.identity();
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(lut.apply(v)).toBeCloseTo(v, 6);
    }
  });

  it('from() keeps exactly 257 entries and reads endpoints', () => {
    const values = Array.from({ length: 257 }, (_, i) => i / 256); // identity ramp
    const lut = CurveLut.from(values);
    expect(lut.size).toBe(257);
    expect(lut.apply(0)).toBeCloseTo(0, 6);
    expect(lut.apply(1)).toBeCloseTo(1, 6);
  });

  it('interpolates between entries', () => {
    // LUT that doubles: y = 2x (clamped to 1). Entry i => min(1, 2*i/256).
    const values = Array.from({ length: 257 }, (_, i) => Math.min(1, (2 * i) / 256));
    const lut = CurveLut.from(values);
    // At v=0.25 (index 64), y = 0.5; at v=0.125 (index 32), y = 0.25.
    expect(lut.apply(0.25)).toBeCloseTo(0.5, 5);
    expect(lut.apply(0.125)).toBeCloseTo(0.25, 5);
    // Mid-segment (index 64.5, frac 0.5): blend of lut[64]=0.5 and lut[65]=130/256.
    expect(lut.apply(0.25 + 0.5 / 256)).toBeCloseTo((0.5 + 130 / 256) / 2, 5);
  });

  it('clamps out-of-range input to [0,1]', () => {
    const lut = CurveLut.identity();
    expect(lut.apply(-0.5)).toBeCloseTo(0, 6);
    expect(lut.apply(1.5)).toBeCloseTo(1, 6);
  });

  it('throws if the input is not 257 entries', () => {
    expect(() => CurveLut.from([0, 1])).toThrow();
  });

  it('returns a defensive Float32Array copy for GPU and worker transport', () => {
    const lut = CurveLut.identity();
    const values = lut.toFloat32Array();
    expect(values).toHaveLength(257);
    values[128] = 0;
    expect(lut.apply(0.5)).toBeCloseTo(0.5, 6);
  });
});
