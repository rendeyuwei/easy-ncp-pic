import { describe, it, expect } from 'vitest';
import { nodeDecode, nodeEncode } from './helpers/node-platform';

describe('nodePlatform helper', () => {
  it('encodes then decodes RGBA preserving dimensions and (losslessly for PNG) pixels', async () => {
    const w = 2;
    const h = 1;
    const rgba = new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 255]);
    const png = await nodeEncode(rgba, w, h, 'image/png', 0.92);
    expect(png.length).toBeGreaterThan(0);
    const decoded = await nodeDecode(png);
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(Array.from(decoded.data)).toEqual(Array.from(rgba)); // PNG is lossless
  });
});
