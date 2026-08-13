import { describe, it, expect } from 'vitest';
import {
  decodeImage,
  encodeImage,
  detectImageFormat,
  parseEncodedImageDimensions,
  DEFAULT_JPEG_QUALITY,
} from '../src/codec';
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

  it('reads PNG and JPEG dimensions without decoding pixels', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x27, 0x10, 0x00, 0x00, 0x00, 0x64,
    ]);
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x05, 0x01, 0x02, 0x03,
      0xff, 0xc2, 0x00, 0x11, 0x08, 0x0f, 0xa0, 0x17, 0x70,
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    ]);

    expect(parseEncodedImageDimensions(png)).toEqual({ width: 10000, height: 100 });
    expect(parseEncodedImageDimensions(jpeg)).toEqual({ width: 6000, height: 4000 });
    expect(parseEncodedImageDimensions(new Uint8Array([0xff, 0xd8]))).toBeNull();
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
