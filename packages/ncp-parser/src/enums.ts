import type { EnumValue } from './types';

/** Base Picture Control codes → names. 0x03/0x06 fixture-verified (PICCON02/33). */
export const BASE_PICTURE_CONTROL: Record<number, string> = {
  0x03: 'Neutral', // fixture-verified: PICCON02
  0x06: 'Monochrome', // fixture-verified: PICCON33
};

/** Monochrome filter-effect codes → names (0x80-centered enum; Nikon list). 0x83 fixture-verified. */
export const MONO_FILTER: Record<number, string> = {
  0x80: 'None',
  0x81: 'Yellow',
  0x82: 'Orange',
  0x83: 'Red', // fixture-verified code: PICCON33
  0x84: 'Green',
  0x85: 'Blue',
};

/** Monochrome toning codes → names (Nikon list). 0x84 fixture-verified. */
export const TONING_TYPE: Record<number, string> = {
  0x80: 'None',
  0x81: 'Sepia',
  0x82: 'Cyan',
  0x83: 'Magenta',
  0x84: 'Yellow', // fixture-verified code: PICCON33
  0x85: 'Green',
  0x86: 'Blue',
};

/** Resolve a raw code; unknown codes map to name 'unknown' (never guessed). */
export function enumName(table: Record<number, string>, code: number): EnumValue {
  const name = table[code];
  return name !== undefined ? { code, name } : { code, name: 'unknown' };
}
