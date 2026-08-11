import { describe, it, expect } from 'vitest';
import { parseExifOrientation } from '../src/exif';

/** Build a minimal JPEG carrying an EXIF orientation tag (big-endian "MM"). */
function jpegWithOrientation(orientation: number): Uint8Array {
  const tiff = new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", magic 42, IFD0 at offset 8
    0x00, 0x01, // 1 IFD entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // tag 0x0112 (orientation), type SHORT, count 1
    0x00, orientation, 0x00, 0x00, // value = orientation (big-endian short)
    0x00, 0x00, 0x00, 0x00, // next IFD = 0
  ]);
  const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segLen = exif.length + tiff.length + 2;
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff, // APP1 + length
    ...exif,
    ...tiff,
    0xff, 0xd9, // EOI
  ]);
}

/** Little-endian ("II") variant of the JPEG EXIF orientation fixture. */
function jpegWithOrientationLE(orientation: number): Uint8Array {
  const tiff = new Uint8Array([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", magic 42 (LE), IFD0 at 8 (LE)
    0x01, 0x00, // 1 IFD entry (LE)
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x0112 (LE), SHORT (LE), count 1 (LE)
    orientation, 0x00, 0x00, 0x00, // value = orientation (LE short)
    0x00, 0x00, 0x00, 0x00, // next IFD = 0
  ]);
  const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segLen = exif.length + tiff.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff,
    ...exif,
    ...tiff,
    0xff, 0xd9,
  ]);
}

/** PNG carrying an eXIf chunk (big-endian "MM" TIFF block) with the orientation tag. */
function pngWithOrientation(orientation: number): Uint8Array {
  const tiff = new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
    0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const len = tiff.length;
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, // eXIf chunk length (BE)
    0x65, 0x58, 0x49, 0x66, // "eXIf"
    ...tiff,
    0x00, 0x00, 0x00, 0x00, // CRC (not validated by the parser)
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00, // IEND
  ]);
}

describe('parseExifOrientation', () => {
  it('reads orientations 1..8 from a JPEG EXIF tag', () => {
    for (let o = 1; o <= 8; o++) {
      expect(parseExifOrientation(jpegWithOrientation(o))).toBe(o);
    }
  });

  it('returns 1 for a JPEG without an EXIF segment', () => {
    const noExif = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(parseExifOrientation(noExif)).toBe(1);
  });

  it('returns 1 for non-image / empty input', () => {
    expect(parseExifOrientation(new Uint8Array([]))).toBe(1);
    expect(parseExifOrientation(new Uint8Array([0, 1, 2, 3]))).toBe(1);
  });

  it('returns 1 for a PNG without an eXIf chunk', () => {
    // Minimal PNG signature + IHDR-ish + IEND, no eXIf.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00, // empty IEND chunk
    ]);
    expect(parseExifOrientation(png)).toBe(1);
  });

  it('reads orientations from a little-endian (II) JPEG EXIF tag', () => {
    for (let o = 1; o <= 8; o++) {
      expect(parseExifOrientation(jpegWithOrientationLE(o))).toBe(o);
    }
  });

  it('reads orientation from a PNG eXIf chunk', () => {
    expect(parseExifOrientation(pngWithOrientation(6))).toBe(6);
    expect(parseExifOrientation(pngWithOrientation(3))).toBe(3);
  });
});
