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

/**
 * The camera toning list, codes 0x80..0x89 in menu order. 0x80 'B&W' means "no
 * toning", so it is the one option without a tint (see @easypic/ncp-parser's
 * TONING_TYPE table, which this must stay in step with). `max`/`min` are the
 * channel indices (0=r, 1=g, 2=b) a tint is expected to lead with and to suppress.
 */
const TONING = [
  { code: 0x81, name: 'Sepia', max: 0, min: 2 },
  { code: 0x82, name: 'Cyanotype', max: 2, min: 0 },
  { code: 0x83, name: 'Red', max: 0, min: 2 },
  { code: 0x84, name: 'Yellow', max: 0, min: 2 }, // fixture-verified code: PICCON33
  { code: 0x85, name: 'Green', max: 1, min: 0 },
  { code: 0x86, name: 'Blue Green', max: 2, min: 0 },
  { code: 0x87, name: 'Blue', max: 2, min: 0 },
  { code: 0x88, name: 'Purple Blue', max: 2, min: 1 },
  { code: 0x89, name: 'Red Purple', max: 0, min: 1 },
];

describe('TONING_COLORS', () => {
  it('covers every camera toning option and nothing else', () => {
    expect(Object.keys(TONING_COLORS).map(Number).sort((a, b) => a - b)).toEqual(TONING.map((t) => t.code));
    expect(TONING_COLORS[0x80]).toBeUndefined(); // 'B&W' stays untinted
    expect(toningColorFor(0x80)).toBeNull();
  });

  it.each(TONING)('gives $name a bounded tint', ({ code, max, min }) => {
    const color = TONING_COLORS[code];
    if (!color) throw new Error(`missing tint for 0x${code.toString(16)}`);
    for (const channel of color) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
    expect(color.indexOf(Math.max(...color))).toBe(max);
    expect(color.indexOf(Math.min(...color))).toBe(min);
  });

  it('gives each option its own tint', () => {
    const tints = new Set(TONING.map(({ code }) => JSON.stringify(TONING_COLORS[code])));
    expect(tints.size).toBe(TONING.length);
  });
});
