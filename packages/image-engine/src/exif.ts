function readU16(b: Uint8Array, off: number, le: boolean): number {
  return le ? b[off] | (b[off + 1] << 8) : (b[off] << 8) | b[off + 1];
}

function readU32(b: Uint8Array, off: number, le: boolean): number {
  return le
    ? (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0
    : ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

/** Parse the orientation tag from a TIFF/EXIF block starting at the byte-order mark. */
function parseTiffOrientation(t: Uint8Array): number {
  if (t.length < 8) return 1;
  const le = t[0] === 0x49 && t[1] === 0x49; // "II"
  const be = t[0] === 0x4d && t[1] === 0x4d; // "MM"
  if (!le && !be) return 1;
  if (readU16(t, 2, le) !== 0x002a) return 1;
  const ifdOffset = readU32(t, 4, le);
  if (ifdOffset + 2 > t.length) return 1;
  const count = readU16(t, ifdOffset, le);
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > t.length) break;
    const tag = readU16(t, entry, le);
    if (tag === 0x0112) {
      const type = readU16(t, entry + 2, le);
      const value = type === 3 ? readU16(t, entry + 8, le) : readU32(t, entry + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Return the EXIF orientation (1–8) of a JPEG or PNG, or 1 if none/unknown. */
export function parseExifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4) return 1;
  // JPEG: FF D8 ... scan segments for APP1 (FF E1) carrying "Exif\0\0".
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 4 < bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1];
      const segLen = (bytes[off + 2] << 8) | bytes[off + 3];
      if (marker === 0xe1) {
        const data = off + 4;
        if (
          bytes[data] === 0x45 && bytes[data + 1] === 0x78 && bytes[data + 2] === 0x69 &&
          bytes[data + 3] === 0x66 && bytes[data + 4] === 0x00 && bytes[data + 5] === 0x00
        ) {
          return parseTiffOrientation(bytes.subarray(data + 6));
        }
      }
      if (marker === 0xda) break; // start of scan; no more metadata segments
      if (segLen < 2) break;
      off += 2 + segLen;
    }
    return 1;
  }
  // PNG: scan chunks for "eXIf" (its data is a TIFF/EXIF block).
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    let off = 8;
    while (off + 8 < bytes.length) {
      const len = readU32(bytes, off, false);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (type === 'eXIf') return parseTiffOrientation(bytes.subarray(off + 8, off + 8 + len));
      if (type === 'IEND') break;
      off += 12 + len;
    }
    return 1;
  }
  return 1;
}
