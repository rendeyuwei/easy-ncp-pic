import {
  OFF,
  NCP_SIGNATURE,
  NCP_ASCII_VERSION,
  SUPPORTED_MAJOR_VERSION,
  EXPECTED_LENGTH,
  HEADER_LENGTH_VALUE,
  LUT_COUNT,
  LUT_MAX,
} from '../../src/constants';

export interface BuildOptions {
  name?: string;
  signature?: number[];
  majorVersion?: number;
  headerLength?: number;
  asciiVersion?: string;
  /** Final buffer length — set below 638 to test truncation. */
  length?: number;
  curveEnabled?: number;
  gammaByte?: number;
  points?: Array<[number, number]>;
  /** Override the stored point-count byte (mismatch / overflow tests). */
  pointCountByte?: number;
  /** Raw 15-bit LUT values (0..32767), length 257. */
  lut?: number[];
  /** 26-byte adjustment region (0x24..0x3D). */
  adjustments?: Uint8Array;
}

function defaultLut(): number[] {
  const out: number[] = new Array(LUT_COUNT);
  for (let i = 0; i < LUT_COUNT; i++) out[i] = Math.round((i / (LUT_COUNT - 1)) * LUT_MAX);
  return out;
}

export function buildNcp(opts: BuildOptions = {}): Uint8Array {
  const buf = new Uint8Array(EXPECTED_LENGTH); // 638 zero bytes
  const dv = new DataView(buf.buffer);

  const sig = opts.signature ?? [...NCP_SIGNATURE];
  sig.forEach((b, i) => {
    buf[OFF.signature + i] = b;
  });
  dv.setUint32(OFF.majorVersion, opts.majorVersion ?? SUPPORTED_MAJOR_VERSION, false);
  dv.setUint32(OFF.headerLength, opts.headerLength ?? HEADER_LENGTH_VALUE, false);
  const ascii = opts.asciiVersion ?? NCP_ASCII_VERSION;
  for (let i = 0; i < ascii.length; i++) buf[OFF.asciiVersion + i] = ascii.charCodeAt(i);

  const name = opts.name ?? 'TestFilter';
  for (let i = 0; i < name.length && i < OFF.nameLength; i++) buf[OFF.name + i] = name.charCodeAt(i);

  if (opts.adjustments) buf.set(opts.adjustments.subarray(0, 26), OFF.adjustments);

  buf[OFF.curveEnabled] = opts.curveEnabled ?? 1;
  buf[OFF.curveGamma] = opts.gammaByte ?? 0x0f;

  const points = opts.points ?? [[0, 0], [128, 128], [255, 255]];
  buf[OFF.pointCount] = opts.pointCountByte ?? points.length;
  points.forEach(([x, y], i) => {
    buf[OFF.points + i * 2] = x;
    buf[OFF.points + i * 2 + 1] = y;
  });

  const lut = opts.lut ?? defaultLut();
  for (let i = 0; i < LUT_COUNT; i++) dv.setUint16(OFF.lut + i * 2, lut[i] ?? 0, false);

  if (opts.length !== undefined) return buf.slice(0, opts.length);
  return buf;
}
