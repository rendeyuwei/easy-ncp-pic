import { describe, it, expect } from 'vitest';
import { applySaturation, applyHue } from '../src/adjust';

describe('applySaturation', () => {
  it('amount 0 leaves color unchanged', () => {
    const [r, g, b] = applySaturation(0.8, 0.4, 0.2, 0);
    expect(r).toBeCloseTo(0.8, 6);
    expect(g).toBeCloseTo(0.4, 6);
    expect(b).toBeCloseTo(0.2, 6);
  });

  it('positive amount increases spread from luminance', () => {
    const [r, g, b] = applySaturation(0.8, 0.4, 0.2, 3);
    expect(r).toBeGreaterThan(0.8);
    expect(b).toBeLessThan(0.2);
  });

  it('amount -10 collapses to grayscale (all channels = luminance)', () => {
    const [r, g, b] = applySaturation(0.8, 0.4, 0.2, -10);
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
  });

  it('gray is unaffected by saturation', () => {
    const [r, g, b] = applySaturation(0.5, 0.5, 0.5, 5);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });
});

describe('applyHue', () => {
  it('amount 0 leaves color unchanged', () => {
    const [r, g, b] = applyHue(0.8, 0.4, 0.2, 0);
    expect(r).toBeCloseTo(0.8, 5);
    expect(g).toBeCloseTo(0.4, 5);
    expect(b).toBeCloseTo(0.2, 5);
  });

  it('a full 360 rotation (amount 72) returns to the same color', () => {
    const [r, g, b] = applyHue(0.8, 0.4, 0.2, 72);
    expect(r).toBeCloseTo(0.8, 4);
    expect(g).toBeCloseTo(0.4, 4);
    expect(b).toBeCloseTo(0.2, 4);
  });

  it('gray is unaffected by hue', () => {
    const [r, g, b] = applyHue(0.5, 0.5, 0.5, 20);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });
});
