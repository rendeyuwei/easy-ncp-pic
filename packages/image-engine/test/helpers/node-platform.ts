import { createCanvas, loadImage } from '@napi-rs/canvas';

export interface DecodedPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decode image bytes to raw RGBA pixels (no EXIF auto-rotation). */
export async function nodeDecode(bytes: Uint8Array): Promise<DecodedPixels> {
  const img = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  return { data: new Uint8ClampedArray(id.data), width: id.width, height: id.height };
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
  const buf = type === 'image/jpeg' ? canvas.toBuffer('image/jpeg', { quality }) : canvas.toBuffer('image/png');
  return new Uint8Array(buf);
}
