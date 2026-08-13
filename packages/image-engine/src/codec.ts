import type { Platform, DecodedImage } from './platform';

export const DEFAULT_JPEG_QUALITY = 0.92;

export interface EncodeOptions {
  type?: 'image/jpeg' | 'image/png';
  quality?: number;
}

export interface EncodedImageDimensions {
  width: number;
  height: number;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 0x1000000)
    + (bytes[offset + 1] << 16)
    + (bytes[offset + 2] << 8)
    + bytes[offset + 3];
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

/** Reads encoded dimensions from PNG/JPEG headers without allocating decoded pixels. */
export function parseEncodedImageDimensions(bytes: Uint8Array): EncodedImageDimensions | null {
  const isPng = bytes.length >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[12] === 0x49
    && bytes[13] === 0x48
    && bytes[14] === 0x44
    && bytes[15] === 0x52;
  if (isPng) return { width: uint32(bytes, 16), height: uint32(bytes, 20) };

  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) return null;
    const segmentLength = uint16(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      return {
        width: uint16(bytes, offset + 5),
        height: uint16(bytes, offset + 3),
      };
    }
    offset += segmentLength;
  }
  return null;
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
