import type { EnumValue } from './types';

/**
 * Base Picture Control codes → names. The code is the 16-bit big-endian value
 * read from 0x24..0x25 (two bytes — see ADJ.base).
 *
 * Only Neutral and Monochrome are fixture-verified against the files in
 * test/fixtures; the other four come from the community-documented table on the
 * third-party nikonpicturecontrol.com reference and are labelled accordingly.
 */
export const BASE_PICTURE_CONTROL: Record<number, string> = {
  0x0001: 'Standard', // community-documented (shares high byte 0x00 with Vivid)
  0x00c3: 'Vivid', // community-documented
  0x03c2: 'Neutral', // fixture-verified: PICCON02
  0x0486: 'Portrait', // community-documented (shares high byte 0x04 with Landscape)
  0x04c7: 'Landscape', // community-documented
  0x064d: 'Monochrome', // fixture-verified: PICCON33
};

/**
 * Monochrome filter-effect codes → names (0x80-centered enum; Nikon's camera list).
 * 0x83 is the fixture-verified code (PICCON33). 0x85 'Blue' is the documented
 * camera value; deeper tones (0x86+) are not decoded and stay 'unknown'.
 */
export const MONO_FILTER: Record<number, string> = {
  0x80: 'None', // camera "Off"
  0x81: 'Yellow',
  0x82: 'Orange',
  0x83: 'Red', // fixture-verified code: PICCON33
  0x84: 'Green',
  0x85: 'Blue',
};

/**
 * Monochrome toning codes → names (0x80-centered), following the list Nikon cameras
 * show in the menu: B&W, Sepia, Cyanotype, Red, Yellow, Green, Blue Green, Blue,
 * Purple Blue, Red Purple. 0x84 'Yellow' is the fixture-verified code (PICCON33);
 * the rest are the documented camera list. 0x80 'B&W' means "no toning tint".
 */
export const TONING_TYPE: Record<number, string> = {
  0x80: 'B&W',
  0x81: 'Sepia',
  0x82: 'Cyanotype',
  0x83: 'Red',
  0x84: 'Yellow', // fixture-verified code: PICCON33
  0x85: 'Green',
  0x86: 'Blue Green',
  0x87: 'Blue',
  0x88: 'Purple Blue',
  0x89: 'Red Purple',
};

/** Resolve a raw code; unknown codes map to name 'unknown' (never guessed). */
export function enumName(table: Record<number, string>, code: number): EnumValue {
  const name = table[code];
  return name !== undefined ? { code, name } : { code, name: 'unknown' };
}
