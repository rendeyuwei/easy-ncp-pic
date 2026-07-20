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
