/**
 * Minimal standalone NCP byte-builder for api-server tests (mirrors
 * packages/ncp-parser/test/helpers/build-ncp.ts with inlined constants, so the
 * api-server suite does not depend on ncp-parser internals or extra binary
 * fixtures). Output satisfies validateStructure and parses as a supported v1 file.
 */
const EXPECTED_LENGTH = 638;
const OFF = {
  signature: 0x00,
  majorVersion: 0x04,
  headerLength: 0x08,
  asciiVersion: 0x0c,
  name: 0x10, // 0x10..0x23
  adjustments: 0x24, // base code u16 BE at 0x24; sharpening 0x28 ... toningStrength 0x2f
  curveEnabled: 0x3e,
  curveGamma: 0x3f,
  pointCount: 0x40,
  points: 0x41,
  lut: 0x78,
} as const;
const LUT_COUNT = 257;
const LUT_MAX = 32767;

export interface BuildOptions {
  name?: string;
  /** 16-bit big-endian base Picture Control code (0x0001 Standard, 0x03c2 Neutral, ...). */
  baseCode?: number;
  /** Monochrome filter byte (only decoded for a Monochrome base). */
  monoFilter?: number;
  toningType?: number;
  /** Change to produce distinct SHA-256 hashes for same-named files. */
  gammaByte?: number;
}

export function buildNcp(opts: BuildOptions = {}): Uint8Array {
  const buf = new Uint8Array(EXPECTED_LENGTH);
  const dv = new DataView(buf.buffer);

  [0x4e, 0x43, 0x50, 0x00].forEach((b, i) => {
    buf[OFF.signature + i] = b;
  });
  dv.setUint32(OFF.majorVersion, 1, false);
  dv.setUint32(OFF.headerLength, 0x24, false);
  for (let i = 0; i < 4; i++) buf[OFF.asciiVersion + i] = '0100'.charCodeAt(i);

  const name = opts.name ?? 'Test Filter';
  for (let i = 0; i < name.length && i < 20; i++) buf[OFF.name + i] = name.charCodeAt(i);

  dv.setUint16(OFF.adjustments, opts.baseCode ?? 0x0001, false); // Standard
  buf[OFF.adjustments + 4] = 0x82; // sharpening +2
  buf[OFF.adjustments + 5] = 0x01; // contrast: curve-driven
  buf[OFF.adjustments + 6] = 0x01; // brightness: curve-driven
  buf[OFF.adjustments + 7] = 0x80; // saturation 0
  buf[OFF.adjustments + 8] = 0x80; // hue 0
  buf[OFF.adjustments + 9] = opts.monoFilter ?? 0x83; // decoded only for Monochrome
  buf[OFF.adjustments + 10] = opts.toningType ?? 0x80;
  buf[OFF.adjustments + 11] = 0x82;

  buf[OFF.curveEnabled] = 1;
  buf[OFF.curveGamma] = opts.gammaByte ?? 0x0f;
  buf[OFF.pointCount] = 3;
  const points = [
    [0, 0],
    [128, 128],
    [255, 255],
  ] as const;
  points.forEach(([x, y], i) => {
    buf[OFF.points + i * 2] = x;
    buf[OFF.points + i * 2 + 1] = y;
  });

  for (let i = 0; i < LUT_COUNT; i++) {
    dv.setUint16(OFF.lut + i * 2, Math.round((i / (LUT_COUNT - 1)) * LUT_MAX), false);
  }
  return buf;
}

/** 638 bytes with a wrong signature (length is valid, so validation fails on the signature). */
export function invalidNcpBytes(): Uint8Array {
  const buf = new Uint8Array(EXPECTED_LENGTH);
  buf.set(new TextEncoder().encode('this is not a Nikon Picture Control file'));
  return buf;
}

/** Truncated valid file — fails the 638-byte length check (BAD_LENGTH). */
export function truncatedNcpBytes(): Uint8Array {
  return buildNcp({ name: 'Truncated' }).slice(0, 300);
}
