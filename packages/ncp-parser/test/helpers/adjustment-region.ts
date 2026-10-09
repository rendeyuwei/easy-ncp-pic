import { ADJ, CENTER } from '../../src/constants';

/**
 * A 26-byte adjustment region (0x24..0x3d) for synthetic NCPs: neutral 0x80-centered
 * levels, curve-driven contrast/brightness (0x01), valid monochrome enums (0x80 =
 * filter "None", toning "B&W"), and the reserved bytes seen in the genuine fixtures.
 *
 * `patches` overrides individual bytes by ABSOLUTE offset (use the ADJ.* constants),
 * so each test only states the field it cares about. The base Picture Control bytes at
 * 0x24..0x25 are left zero here — pass `baseCode` to buildNcp() instead.
 */
export function adjustmentRegion(patches: Record<number, number> = {}): Uint8Array {
  const neutral: Record<number, number> = {
    [ADJ.modified]: 0x00, // PICCON02 stores 0x00, PICCON33 0x02
    [ADJ.reserved27]: 0xff,
    [ADJ.sharpening]: CENTER,
    [ADJ.contrast]: 0x01, // "the custom curve controls contrast" (both fixtures)
    [ADJ.brightness]: 0x01,
    [ADJ.saturation]: CENTER,
    [ADJ.hue]: CENTER,
    [ADJ.monoFilter]: CENTER,
    [ADJ.toningType]: CENTER,
    [ADJ.toningStrength]: CENTER,
  };
  const bytes = new Uint8Array(26);
  for (const [offset, value] of Object.entries({ ...neutral, ...patches })) {
    bytes[Number(offset) - ADJ.base] = value;
  }
  return bytes;
}
