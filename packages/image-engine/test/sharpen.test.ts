import { describe, it, expect } from 'vitest';
import { sharpen } from '../src/sharpen';
import { createPixelBuffer } from '../src/pixel';

function solid(w: number, h: number, v: number) {
  const buf = createPixelBuffer(w, h);
  buf.data.fill(v);
  return buf;
}

describe('sharpen', () => {
  it('sharpening 0 returns identical pixels', () => {
    const buf = solid(3, 3, 0.5);
    const out = sharpen(buf, 0);
    expect(Array.from(out.data)).toEqual(Array.from(buf.data));
  });

  it('a flat image stays flat after sharpening (no detail to enhance)', () => {
    const buf = solid(4, 4, 0.6);
    const out = sharpen(buf, 5);
    for (const v of out.data) expect(v).toBeCloseTo(0.6, 6);
  });

  it('enhances an edge: the bright side gets brighter, dark side darker', () => {
    // 3x1 image: dark | bright | bright
    const buf = createPixelBuffer(3, 1);
    buf.data.set([0.2, 0.2, 0.2, 1, 0.8, 0.8, 0.8, 1, 0.8, 0.8, 0.8, 1]);
    const out = sharpen(buf, 5);
    // The first (dark) pixel sits next to a bright neighbor -> its detail is negative -> darker or equal.
    expect(out.data[0]).toBeLessThanOrEqual(buf.data[0] + 1e-6);
    // The middle (bright) pixel next to a dark neighbor -> enhanced brighter or equal.
    expect(out.data[4]).toBeGreaterThanOrEqual(buf.data[4] - 1e-6);
  });

  it('limits halos: detail is clamped to +-0.5 before scaling (bright center on dark field)', () => {
    // 3x3 image, center pixel = 1, all neighbors = 0.
    // Center detail = 1 - (1/9) = 8/9 > 0.5, so the clamp actually engages.
    const buf = createPixelBuffer(3, 3);
    const c = (1 * 3 + 1) * 4; // center pixel offset
    buf.data[c] = 1;
    buf.data[c + 1] = 1;
    buf.data[c + 2] = 1;
    buf.data[c + 3] = 1;
    const out = sharpen(buf, 10); // amount = 10 * 0.15 = 1.5
    // Unclamped delta would be 1.5 * 8/9 = 1.333; clamped detail (0.5) gives 1.5 * 0.5 = 0.75.
    expect(out.data[c]).toBeCloseTo(1 + 0.75, 5);
    expect(out.data[c]).toBeLessThan(1 + 1.0); // well below the unclamped 2.333
    expect(out.data[c + 3]).toBe(1); // alpha preserved
  });
});
