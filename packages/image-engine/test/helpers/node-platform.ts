import { createCanvas, loadImage } from '@napi-rs/canvas';
import { parseExifOrientation } from '../../src/exif';
import { applyOrientationToBuffer } from '../../src/orientation';
import { fromUint8Rgba, toUint8Rgba } from '../../src/pixel';

export interface DecodedPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Decode image bytes to RGBA pixels, applying EXIF orientation to simulate the
 * browser's automatic orientation handling — so nodeDecode returns ORIENTED pixels
 * just like browserPlatform. The engine trusts the platform's oriented output.
 */
export async function nodeDecode(bytes: Uint8Array): Promise<DecodedPixels> {
  const img = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  const orientation = parseExifOrientation(bytes);
  const oriented = applyOrientationToBuffer(
    fromUint8Rgba(new Uint8ClampedArray(id.data), id.width, id.height),
    orientation,
  );
  return { data: toUint8Rgba(oriented), width: oriented.width, height: oriented.height };
}

/** Encode RGBA pixels to an image byte buffer. */
export async function nodeEncode(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  type: 'image/jpeg' | 'image/png',
  quality: number,
): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(width, height);
  id.data.set(rgba);
  ctx.putImageData(id, 0, 0);
  // Separate branches so each @napi-rs/canvas toBuffer overload resolves independently;
  // the jpeg/webp overload takes a plain `quality?: number`, not a config object.
  const buf = type === 'image/jpeg'
    ? canvas.toBuffer('image/jpeg', quality)
    : canvas.toBuffer('image/png');
  return new Uint8Array(buf);
}
