import type { Platform, DecodedImage } from './platform';

export const DEFAULT_JPEG_QUALITY = 0.92;

export interface EncodeOptions {
  type?: 'image/jpeg' | 'image/png';
  quality?: number;
}

export async function decodeImage(bytes: Uint8Array, platform: Platform): Promise<DecodedImage> {
  return platform.decode(bytes);
}

export async function encodeImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EncodeOptions,
  platform: Platform,
): Promise<Uint8Array> {
  const type = opts.type ?? 'image/jpeg';
  const quality = opts.quality ?? DEFAULT_JPEG_QUALITY;
  return platform.encode(rgba, width, height, { type, quality });
}

/** Detect the image format from the magic bytes (defaults to JPEG). */
export function detectImageFormat(bytes: Uint8Array): 'image/jpeg' | 'image/png' {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  return 'image/jpeg';
}
