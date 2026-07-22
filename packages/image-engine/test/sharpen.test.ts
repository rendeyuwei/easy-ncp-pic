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

  it('limits halos: detail is clamped so output stays within [-0.5,+0.5] of input on a stark edge', () => {
    const buf = createPixelBuffer(3, 1);
    buf.data.set([0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    const out = sharpen(buf, 10);
    for (let i = 0; i < out.data.length; i++) {
      expect(Math.abs(out.data[i] - buf.data[i])).toBeLessThanOrEqual(0.5 + 1e-6);
    }
  });
});
