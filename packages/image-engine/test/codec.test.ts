import { describe, it, expect } from 'vitest';
import { decodeImage, encodeImage, detectImageFormat, DEFAULT_JPEG_QUALITY } from '../src/codec';
import type { Platform } from '../src/platform';
import { nodeDecode, nodeEncode } from './helpers/node-platform';

const nodePlatform: Platform = {
  decode: (b) => nodeDecode(b),
  encode: (rgba, w, h, p) => nodeEncode(rgba, w, h, p.type, p.quality),
};

const rgba = new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 255]); // 2x1

describe('codec', () => {
  it('DEFAULT_JPEG_QUALITY is 0.92', () => {
    expect(DEFAULT_JPEG_QUALITY).toBe(0.92);
  });

  it('detectImageFormat distinguishes PNG from JPEG', () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageFormat(new Uint8Array([]))).toBe('image/jpeg');
  });

  it('encode (PNG) then decode round-trips dimensions and pixels losslessly', async () => {
    const png = await encodeImage(rgba, 2, 1, { type: 'image/png' }, nodePlatform);
    const decoded = await decodeImage(png, nodePlatform);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.data)).toEqual(Array.from(rgba));
  });

  it('defaults to JPEG when type is omitted', async () => {
    const bytes = await encodeImage(rgba, 2, 1, {}, nodePlatform);
    // JPEG SOI marker.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('JPEG encode is decodable and preserves dimensions', async () => {
    const bytes = await encodeImage(rgba, 2, 1, { type: 'image/jpeg', quality: 0.92 }, nodePlatform);
    const decoded = await decodeImage(bytes, nodePlatform);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
  });
});
