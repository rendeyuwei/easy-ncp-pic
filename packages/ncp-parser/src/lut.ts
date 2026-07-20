import { BinaryReader } from './reader';
import { NcpParseError } from './errors';
import { OFF, LUT_COUNT, LUT_MAX } from './constants';

export function readLut257(reader: BinaryReader): number[] {
  const out = new Array<number>(LUT_COUNT);
  for (let i = 0; i < LUT_COUNT; i++) {
    const raw = reader.uint16BE(OFF.lut + i * 2);
    if (raw > LUT_MAX) {
      throw new NcpParseError('LUT_OUT_OF_RANGE', `LUT[${i}]=${raw} exceeds 15-bit max ${LUT_MAX}`);
    }
    out[i] = raw / LUT_MAX;
  }
  return out;
}
