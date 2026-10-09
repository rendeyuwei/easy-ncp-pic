import { describe, it, expect } from 'vitest';
import { parseNcp } from '../src/index';
import { ADJ } from '../src/constants';
import { BASE_PICTURE_CONTROL } from '../src/enums';
import { buildNcp } from './helpers/build-ncp';
import { adjustmentRegion } from './helpers/adjustment-region';

/**
 * The six standard Nikon base Picture Controls. Codes are the 16-bit big-endian
 * value stored at 0x24..0x25; Neutral and Monochrome are fixture-verified, the
 * other four are community-documented.
 */
const BASES = [
  { code: 0x0001, name: 'Standard' },
  { code: 0x00c3, name: 'Vivid' },
  { code: 0x03c2, name: 'Neutral' },
  { code: 0x0486, name: 'Portrait' },
  { code: 0x04c7, name: 'Landscape' },
  { code: 0x064d, name: 'Monochrome' },
] as const;

describe('base Picture Control (16-bit big-endian at 0x24..0x25)', () => {
  it.each(BASES)('supports the $name base and reports its code', ({ code, name }) => {
    const r = parseNcp(buildNcp({ baseCode: code, adjustments: adjustmentRegion() }));
    expect(r.basePictureControl).toEqual({ code, name });
    expect(r.supported).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it('keys the table by the full 16-bit code, not by the high byte', () => {
    // Standard/Vivid share 0x00 and Portrait/Landscape share 0x04, which is why a
    // single-byte read of 0x24 cannot name every base.
    expect(Object.keys(BASE_PICTURE_CONTROL)).toHaveLength(6);
    expect(BASE_PICTURE_CONTROL[0x00]).toBeUndefined();
    expect(BASE_PICTURE_CONTROL[0x04]).toBeUndefined();
  });

  it('refuses a byte-swapped (little-endian) base code', () => {
    const r = parseNcp(buildNcp({ baseCode: 0xc203, adjustments: adjustmentRegion() }));
    expect(r.basePictureControl).toEqual({ code: 0xc203, name: 'unknown' });
    expect(r.supported).toBe(false);
  });

  it('refuses an unknown base code and reports the raw code', () => {
    const r = parseNcp(buildNcp({ baseCode: 0x0999, adjustments: adjustmentRegion() }));
    expect(r.basePictureControl).toEqual({ code: 0x0999, name: 'unknown' });
    expect(r.supported).toBe(false);
    expect(r.warnings).toContain(`unknown base Picture Control code ${0x0999}`);
    expect(r.warnings).toContain('unsupported NCP variant: unknown enum value');
  });

  it('reads monochrome filter/toning only for the Monochrome base', () => {
    const r = parseNcp(
      buildNcp({
        baseCode: 0x064d,
        adjustments: adjustmentRegion({
          [ADJ.monoFilter]: 0x83,
          [ADJ.toningType]: 0x87,
          [ADJ.toningStrength]: 0x82,
        }),
      }),
    );
    expect(r.monochromeFilter).toEqual({ code: 0x83, name: 'Red' });
    expect(r.toningType).toEqual({ code: 0x87, name: 'Blue' });
    expect(r.toningStrength).toBe(2);

    // A color base with junk mono bytes stays supported: those fields are not read.
    const color = parseNcp(
      buildNcp({ baseCode: 0x04c7, adjustments: adjustmentRegion({ [ADJ.monoFilter]: 0x99, [ADJ.toningType]: 0x99 }) }),
    );
    expect(color.basePictureControl.name).toBe('Landscape');
    expect(color.monochromeFilter).toBeNull();
    expect(color.toningType).toBeNull();
    expect(color.toningStrength).toBeNull();
    expect(color.supported).toBe(true);
    expect(color.warnings).toEqual([]);
  });
});
