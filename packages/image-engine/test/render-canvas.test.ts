import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { renderCanvas } from '../src/render-canvas';
import { fromParsedPictureControl } from '../src/params';

const here = dirname(fileURLToPath(import.meta.url));
const astia = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')))),
);

function grayImage(w: number, h: number, v: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('renderCanvas (reference path)', () => {
  it('preserves dimensions', () => {
    const out = renderCanvas(grayImage(8, 6, 128), astia, 1);
    expect(out.width).toBe(8);
    expect(out.height).toBe(6);
    expect(out.data.length).toBe(8 * 6 * 4);
  });

  it('changes pixels when a real filter is applied at full intensity', () => {
    const input = grayImage(4, 4, 128);
    const out = renderCanvas(input, astia, 1);
    // A real curve/filter should move at least some pixels off the input value.
    const changed = Array.from(out.data).some((v, i) => v !== input.data[i]);
    expect(changed).toBe(true);
  });

  it('intensity 0 returns the input unchanged', () => {
    const input = grayImage(4, 4, 128);
    const out = renderCanvas(input, astia, 0);
    expect(Array.from(out.data)).toEqual(Array.from(input.data));
  });

  it('output is within [0,255]', () => {
    const out = renderCanvas(grayImage(4, 4, 200), astia, 1);
    for (const v of out.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
