import { describe, it, expect } from 'vitest';
import { applyOrientationToBuffer } from '../src/orientation';
import { createPixelBuffer } from '../src/pixel';

/** 2x1 image: pixel(0,0)=A, pixel(1,0)=B (distinct RGBA). */
function twoByOne(): ReturnType<typeof createPixelBuffer> {
  const buf = createPixelBuffer(2, 1);
  buf.data.set([1, 1, 1, 1, 2, 2, 2, 2]);
  return buf;
}
function px(buf: ReturnType<typeof createPixelBuffer>, x: number, y: number): number[] {
  const i = (y * buf.width + x) * 4;
  return Array.from(buf.data.slice(i, i + 4));
}

/** 3x2 image (non-square, to catch dimension-swap bugs) with 6 distinct pixels. */
function distinct3x2(): ReturnType<typeof createPixelBuffer> {
  const buf = createPixelBuffer(3, 2);
  for (let i = 0; i < 3 * 2; i++) {
    buf.data[i * 4] = i + 1;
    buf.data[i * 4 + 1] = i + 1;
    buf.data[i * 4 + 2] = i + 1;
    buf.data[i * 4 + 3] = 1;
  }
  return buf;
}

/** Inverse of each EXIF orientation (5/7 are self-inverse; 6<->8). */
const ORIENTATION_INVERSE: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 7, 8: 6 };

describe('applyOrientationToBuffer', () => {
  it('orientation 1 is the identity (a clone)', () => {
    const out = applyOrientationToBuffer(twoByOne(), 1);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(px(out, 0, 0)).toEqual([1, 1, 1, 1]);
    expect(px(out, 1, 0)).toEqual([2, 2, 2, 2]);
  });

  it('orientation 3 rotates 180 (dims unchanged, pixels swapped)', () => {
    const out = applyOrientationToBuffer(twoByOne(), 3);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(px(out, 0, 0)).toEqual([2, 2, 2, 2]);
    expect(px(out, 1, 0)).toEqual([1, 1, 1, 1]);
  });

  it('orientation 2 mirrors horizontally', () => {
    const out = applyOrientationToBuffer(twoByOne(), 2);
    expect(px(out, 0, 0)).toEqual([2, 2, 2, 2]);
    expect(px(out, 1, 0)).toEqual([1, 1, 1, 1]);
  });

  it('orientation 6 rotates 90 CW and swaps dimensions (2x1 -> 1x2)', () => {
    const out = applyOrientationToBuffer(twoByOne(), 6);
    expect(out.width).toBe(1);
    expect(out.height).toBe(2);
    // 90 CW: left pixel (A) goes to top, right pixel (B) goes to bottom.
    expect(px(out, 0, 0)).toEqual([1, 1, 1, 1]);
    expect(px(out, 0, 1)).toEqual([2, 2, 2, 2]);
  });

  it('orientation 8 rotates 270 CW (90 CCW) and swaps dimensions', () => {
    const out = applyOrientationToBuffer(twoByOne(), 8);
    expect(out.width).toBe(1);
    expect(out.height).toBe(2);
    // 90 CCW: left pixel (A) goes to bottom, right pixel (B) goes to top.
    expect(px(out, 0, 0)).toEqual([2, 2, 2, 2]);
    expect(px(out, 0, 1)).toEqual([1, 1, 1, 1]);
  });

  it('unknown orientation (<1 or >8) behaves as identity', () => {
    const out = applyOrientationToBuffer(twoByOne(), 99);
    expect(px(out, 0, 0)).toEqual([1, 1, 1, 1]);
    expect(px(out, 1, 0)).toEqual([2, 2, 2, 2]);
  });

  it('every orientation is reversible: apply then its inverse restores the original (pins 4/5/7 too)', () => {
    const src = distinct3x2();
    const original = Array.from(src.data);
    for (let o = 1; o <= 8; o++) {
      const once = applyOrientationToBuffer(src, o);
      const back = applyOrientationToBuffer(once, ORIENTATION_INVERSE[o]);
      expect(back.width).toBe(src.width);
      expect(back.height).toBe(src.height);
      expect(Array.from(back.data)).toEqual(original);
    }
  });

  it('does not mutate the input buffer', () => {
    const src = distinct3x2();
    const before = Array.from(src.data);
    applyOrientationToBuffer(src, 6);
    expect(Array.from(src.data)).toEqual(before);
  });
});
