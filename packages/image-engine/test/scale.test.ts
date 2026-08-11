import { describe, it, expect } from 'vitest';
import { scaleBuffer } from '../src/scale';
import { createPixelBuffer } from '../src/pixel';

function checker2x2(): ReturnType<typeof createPixelBuffer> {
  const buf = createPixelBuffer(2, 2);
  buf.data.set([
    10, 10, 10, 1, 20, 20, 20, 1, // row 0
    30, 30, 30, 1, 40, 40, 40, 1, // row 1
  ]);
  return buf;
}
function px(buf: ReturnType<typeof createPixelBuffer>, x: number, y: number): number {
  return buf.data[(y * buf.width + x) * 4];
}

describe('scaleBuffer', () => {
  it('same size returns an equal clone (independent buffer)', () => {
    const src = checker2x2();
    const out = scaleBuffer(src, 2, 2);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
    out.data[0] = 99;
    expect(src.data[0]).toBe(10);
  });

  it('upscales 2x2 -> 4x4 by repeating nearest pixels', () => {
    const out = scaleBuffer(checker2x2(), 4, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(px(out, 0, 0)).toBe(10); // top-left source
    expect(px(out, 3, 0)).toBe(20); // top-right source
    expect(px(out, 0, 3)).toBe(30); // bottom-left source
    expect(px(out, 3, 3)).toBe(40); // bottom-right source
  });

  it('downscales 2x2 -> 1x1 to the top-left pixel (nearest)', () => {
    const out = scaleBuffer(checker2x2(), 1, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(px(out, 0, 0)).toBe(10);
  });
});
