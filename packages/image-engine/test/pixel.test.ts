import { describe, it, expect } from 'vitest';
import { createPixelBuffer, clonePixelBuffer, fromUint8Rgba, toUint8Rgba } from '../src/pixel';

describe('PixelBuffer', () => {
  it('createPixelBuffer makes a zero-filled RGBA buffer of width*height*4', () => {
    const buf = createPixelBuffer(2, 3);
    expect(buf.width).toBe(2);
    expect(buf.height).toBe(3);
    expect(buf.data).toBeInstanceOf(Float32Array);
    expect(buf.data.length).toBe(2 * 3 * 4);
    expect(buf.data.every((v) => v === 0)).toBe(true);
  });

  it('clonePixelBuffer copies data independently', () => {
    const a = createPixelBuffer(1, 1);
    a.data[0] = 0.5;
    const b = clonePixelBuffer(a);
    b.data[0] = 0.9;
    expect(a.data[0]).toBe(0.5);
    expect(b.data[0]).toBeCloseTo(0.9, 5);
  });

  it('fromUint8Rgba maps 0..255 to 0..1', () => {
    const buf = fromUint8Rgba(new Uint8ClampedArray([0, 128, 255, 255]), 1, 1);
    expect(buf.data[0]).toBeCloseTo(0, 5);
    expect(buf.data[1]).toBeCloseTo(128 / 255, 5);
    expect(buf.data[2]).toBeCloseTo(1, 5);
    expect(buf.data[3]).toBeCloseTo(1, 5);
  });

  it('toUint8Rgba clamps 0..1 back to 0..255', () => {
    const buf = createPixelBuffer(1, 1);
    buf.data.set([1.5, -0.2, 0.5, 1]); // out-of-range on purpose
    const out = toUint8Rgba(buf);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(128);
    expect(out[3]).toBe(255);
  });
});
