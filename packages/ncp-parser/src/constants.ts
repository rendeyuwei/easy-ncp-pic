export const SCHEMA_VERSION = 1;

/** ASCII "NCP\0". */
export const NCP_SIGNATURE: ReadonlyArray<number> = [0x4e, 0x43, 0x50, 0x00];
export const NCP_ASCII_VERSION = '0100';
export const SUPPORTED_MAJOR_VERSION = 1;
export const EXPECTED_LENGTH = 638;
export const HEADER_LENGTH_VALUE = 0x24;

/** Byte offsets of documented regions (spec §9.2). */
export const OFF = {
  signature: 0x00,
  majorVersion: 0x04,
  headerLength: 0x08,
  asciiVersion: 0x0c,
  name: 0x10,
  nameLength: 20, // 0x10..0x23
  adjustments: 0x24, // 0x24..0x3D — per-field offsets added in Task 8
  curveEnabled: 0x3e,
  curveGamma: 0x3f,
  pointCount: 0x40,
  points: 0x41,
  lut: 0x78,
} as const;

export const LUT_COUNT = 257;
/** 15-bit LUT range max (spec §9.2). */
export const LUT_MAX = 32767;
/** Max control points that fit before the LUT: floor((0x78 - 0x41) / 2) = 27. */
export const MAX_POINTS = Math.floor((OFF.lut - OFF.points) / 2);

/** gamma = GAMMA_BASE + byte * GAMMA_STEP ; 0x00 -> 1.00, 0x0F -> 1.15 (spec §9.2). */
export const GAMMA_BASE = 1.0;
export const GAMMA_STEP = 0.01;

/** 0x80-centered signed adjustment encoding: value = byte - CENTER. */
export const CENTER = 0x80;

/**
 * Per-field offsets inside the 0x24..0x3D adjustment region.
 * Discovered by hex-diffing the genuine fixtures (see the RE results table above)
 * and locked by test/parse-adjustments.test.ts.
 *
 * Fixture bytes, 0x24..0x2f:
 *   PICCON02  03 c2 00 ff 82 01 01 80 80 ff ff ff
 *   PICCON33  06 4d 02 ff 82 01 01 ff ff 83 84 82
 */
export const ADJ = {
  /**
   * Base Picture Control: a 16-bit BIG-ENDIAN code spanning 0x24..0x25
   * (`03 c2` = Neutral in PICCON02, `06 4d` = Monochrome in PICCON33).
   * Reading 0x24 as a single byte is wrong because Standard (0x0001) and
   * Vivid (0x00c3) share the high byte 0x00, as do Portrait (0x0486) and
   * Landscape (0x04c7).
   */
  base: 0x24,
  modified: 0x26, // "modified" flag: 0x00 in PICCON02, 0x02 in PICCON33 — not decoded
  reserved27: 0x27, // 0xff in both fixtures — not decoded
  sharpening: 0x28, // 0x82 -> 2 (0x80-centered) in both fixtures; 0x00 = Auto
  contrast: 0x29, // 0x01 (= driven by the custom curve) in both fixtures
  brightness: 0x2a, // 0x01 (= driven by the custom curve) in both fixtures
  saturation: 0x2b, // 0x80 -> 0 in PICCON02 (color); 0x00 = Auto
  hue: 0x2c, // 0x80 -> 0 in PICCON02 (color)
  monoFilter: 0x2d, // raw enum 0x83 in PICCON33
  toningType: 0x2e, // raw enum 0x84 in PICCON33
  toningStrength: 0x2f, // 0x82 -> 2 (0x80-centered) in PICCON33
} as const;

/**
 * Special contrast/brightness byte values. 0x01 means "the custom curve controls
 * this axis"; 0x00 means Auto. Any other byte is 0x80-centered like the rest.
 */
export const AUTO_BYTE = 0x00;
export const CURVE_BYTE = 0x01;
