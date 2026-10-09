import { describe, it, expect } from 'vitest';
import { parseNcp } from '../src/index';
import { ADJ } from '../src/constants';
import { buildNcp } from './helpers/build-ncp';
import { adjustmentRegion } from './helpers/adjustment-region';
import { NcpParseError } from '../src/errors';

describe('parseNcp', () => {
  it('parses a well-formed synthetic buffer into the schema', () => {
    const r = parseNcp(buildNcp({ name: 'Demo', baseCode: 0x03c2, adjustments: adjustmentRegion() }));
    expect(r.schemaVersion).toBe(1);
    expect(r.sourceFormat).toBe('ncp');
    expect(r.sourceVersion).toBe(1);
    expect(r.sourceName).toBe('Demo');
    expect(r.customCurve.lut257).toHaveLength(257);
    expect(Array.isArray(r.warnings)).toBe(true);
    // contrast/brightness are always decoded by this version of the parser.
    expect(r.contrast).toEqual({ mode: 'curve', value: 0 });
    expect(r.brightness).toEqual({ mode: 'curve', value: 0 });
    expect(r.supported).toBe(true);
  });
  it('flags an all-zero adjustments region as unsupported (unknown base)', () => {
    const r = parseNcp(buildNcp());
    expect(r.basePictureControl).toEqual({ code: 0x0000, name: 'unknown' });
    expect(r.supported).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('throws on truncated input', () => {
    expect(() => parseNcp(buildNcp({ length: 100 }))).toThrowError(NcpParseError);
  });
  it('resolves unknown monochrome filter/toning codes to "unknown" with warnings (no throw)', () => {
    const r = parseNcp(
      buildNcp({
        baseCode: 0x064d, // Monochrome
        adjustments: adjustmentRegion({
          [ADJ.sharpening]: 0x82,
          [ADJ.monoFilter]: 0x99, // unknown code
          [ADJ.toningType]: 0x99, // unknown code
          [ADJ.toningStrength]: 0x82,
        }),
      }),
    );
    expect(r.basePictureControl.name).toBe('Monochrome');
    expect(r.sharpening).toBe(2);
    expect(r.monochromeFilter?.name).toBe('unknown');
    expect(r.toningType?.name).toBe('unknown');
    expect(r.toningStrength).toBe(2);
    expect(r.supported).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('approximates auto sharpening/saturation as 0 without making the file unsupported', () => {
    const r = parseNcp(
      buildNcp({
        baseCode: 0x00c3, // Vivid
        adjustments: adjustmentRegion({ [ADJ.sharpening]: 0x00, [ADJ.saturation]: 0x00 }),
      }),
    );
    expect(r.sharpening).toBe(0);
    expect(r.saturation).toBe(0);
    expect(r.supported).toBe(true);
    expect(r.warnings).toEqual(['auto sharpening approximated as 0', 'auto saturation approximated as 0']);
  });
});
