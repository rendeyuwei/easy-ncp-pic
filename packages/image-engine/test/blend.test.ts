import { describe, it, expect } from 'vitest';
import { blendByIntensity } from '../src/blend';
import { createPixelBuffer } from '../src/pixel';

function px(v: number) {
  const b = createPixelBuffer(1, 1);
  b.data.set([v, v, v, 1]);
  return b;
}

describe('blendByIntensity', () => {
  it('intensity 1 returns the filtered image', () => {
    const out = blendByIntensity(px(0.2), px(0.8), 1);
    expect(out.data[0]).toBeCloseTo(0.8, 6);
  });

  it('intensity 0 returns the original image', () => {
    const out = blendByIntensity(px(0.2), px(0.8), 0);
    expect(out.data[0]).toBeCloseTo(0.2, 6);
  });

  it('intensity 0.5 is the midpoint', () => {
    const out = blendByIntensity(px(0.2), px(0.8), 0.5);
    expect(out.data[0]).toBeCloseTo(0.5, 6);
  });

  it('clamps intensity to [0,1]', () => {
    expect(blendByIntensity(px(0.2), px(0.8), 2).data[0]).toBeCloseTo(0.8, 6);
    expect(blendByIntensity(px(0.2), px(0.8), -1).data[0]).toBeCloseTo(0.2, 6);
  });

  it('throws on dimension mismatch', () => {
    expect(() => blendByIntensity(px(0.2), createPixelBuffer(2, 2), 0.5)).toThrow();
  });
});
