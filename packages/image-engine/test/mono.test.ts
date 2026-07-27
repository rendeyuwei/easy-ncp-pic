import { describe, it, expect } from 'vitest';
import { MONO_FILTER_WEIGHTS, TONING_COLORS, monoToGray, filterWeightsFor, toningColorFor, applyToning } from '../src/mono';
import { REC709 } from '../src/color';

describe('mono', () => {
  it('defines Rec.709 weights for None (0x80)', () => {
    expect(MONO_FILTER_WEIGHTS[0x80]).toEqual(REC709);
  });

  it('defines a red filter (0x83) that emphasizes red', () => {
    const w = MONO_FILTER_WEIGHTS[0x83];
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[0]).toBeGreaterThan(w[2]);
  });

  it('filterWeightsFor falls back to Rec.709 for unknown codes', () => {
    expect(filterWeightsFor(0x00)).toEqual(REC709);
  });

  it('monoToGray computes the weighted sum', () => {
    expect(monoToGray(1, 1, 1, REC709)).toBeCloseTo(1, 6);
    expect(monoToGray(1, 0, 0, [0.5, 0.3, 0.2])).toBeCloseTo(0.5, 6);
  });

  it('toningColorFor returns colors for known codes and null for None/unknown', () => {
    expect(toningColorFor(0x81)).toEqual(TONING_COLORS[0x81]); // Sepia
    expect(toningColorFor(0x80)).toBeNull();
    expect(toningColorFor(0x00)).toBeNull();
  });

  it('applyToning with strength 0 leaves gray unchanged', () => {
    const [r, g, b] = applyToning(0.5, [0.76, 0.6, 0.42], 0);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });

  it('applyToning tints gray toward the toning color as strength grows', () => {
    const weak = applyToning(0.5, [1, 0, 0], 1);
    const strong = applyToning(0.5, [1, 0, 0], 5);
    expect(strong[0]).toBeGreaterThan(weak[0]); // more red
    expect(strong[1]).toBeLessThan(weak[1]);
  });
});
