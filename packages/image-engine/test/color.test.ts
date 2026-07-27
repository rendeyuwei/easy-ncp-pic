import { describe, it, expect } from 'vitest';
import { REC709, luminance, clamp01, rgbToHsl, hslToRgb } from '../src/color';

describe('color', () => {
  it('luminance uses Rec.709 weights by default and sums to 1 for white', () => {
    expect(luminance(1, 1, 1)).toBeCloseTo(1, 6);
    expect(luminance(1, 0, 0)).toBeCloseTo(REC709[0], 6);
    expect(luminance(0, 1, 0)).toBeCloseTo(REC709[1], 6);
    expect(luminance(0, 0, 1)).toBeCloseTo(REC709[2], 6);
  });

  it('luminance honors custom weights', () => {
    expect(luminance(1, 0, 0, [0.5, 0.3, 0.2])).toBeCloseTo(0.5, 6);
  });

  it('clamp01 clamps to [0,1]', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it('rgb<->hsl round-trips primary colors', () => {
    for (const [r, g, b] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0.5], [1, 1, 1]] as const) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [r2, g2, b2] = hslToRgb(h, s, l);
      expect(r2).toBeCloseTo(r, 5);
      expect(g2).toBeCloseTo(g, 5);
      expect(b2).toBeCloseTo(b, 5);
    }
  });

  it('hslToRgb rotates hue correctly (pure red hue=0)', () => {
    const [r, g, b] = hslToRgb(0, 1, 0.5);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(0, 5);
  });
});
