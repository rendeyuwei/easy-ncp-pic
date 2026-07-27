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
});
