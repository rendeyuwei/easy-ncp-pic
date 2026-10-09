import { describe, it, expect } from 'vitest';
import { parseNcp } from '../src/index';
import { ADJ, CENTER } from '../src/constants';
import { MONO_FILTER, TONING_TYPE } from '../src/enums';
import { buildNcp } from './helpers/build-ncp';
import { adjustmentRegion } from './helpers/adjustment-region';

const MONO = 0x064d;

function parseMono(patches: Record<number, number>): ReturnType<typeof parseNcp> {
  return parseNcp(buildNcp({ baseCode: MONO, adjustments: adjustmentRegion(patches) }));
}

describe('TONING_TYPE (Nikon camera list, 0x80-centered)', () => {
  const TONING = [
    { code: 0x80, name: 'B&W' },
    { code: 0x81, name: 'Sepia' },
    { code: 0x82, name: 'Cyanotype' },
    { code: 0x83, name: 'Red' },
    { code: 0x84, name: 'Yellow' }, // fixture-verified code: PICCON33
    { code: 0x85, name: 'Green' },
    { code: 0x86, name: 'Blue Green' },
    { code: 0x87, name: 'Blue' },
    { code: 0x88, name: 'Purple Blue' },
    { code: 0x89, name: 'Red Purple' },
  ];

  it.each(TONING)('maps the $name toning code', ({ code, name }) => {
    expect(TONING_TYPE[code]).toBe(name);
    const r = parseMono({ [ADJ.toningType]: code });
    expect(r.toningType).toEqual({ code, name });
    expect(r.supported).toBe(true);
  });

  it('no longer invents Cyan/Magenta entries that cameras never offer', () => {
    expect(Object.values(TONING_TYPE)).not.toContain('Cyan');
    expect(Object.values(TONING_TYPE)).not.toContain('Magenta');
    // 0x80 is "B&W" (no tint), not a "None" that the old table guessed at.
    expect(TONING_TYPE[CENTER]).toBe('B&W');
  });

  it('refuses a toning code outside the camera list', () => {
    const r = parseMono({ [ADJ.toningType]: 0x8a });
    expect(r.toningType).toEqual({ code: 0x8a, name: 'unknown' });
    expect(r.supported).toBe(false);
    expect(r.warnings).toContain('unknown toning type code 138');
  });
});

describe('MONO_FILTER (Nikon camera list, 0x80-centered)', () => {
  const FILTERS = [
    { code: 0x80, name: 'None' },
    { code: 0x81, name: 'Yellow' },
    { code: 0x82, name: 'Orange' },
    { code: 0x83, name: 'Red' }, // fixture-verified code: PICCON33
    { code: 0x84, name: 'Green' },
    { code: 0x85, name: 'Blue' },
  ];

  it.each(FILTERS)('maps the $name filter code', ({ code, name }) => {
    expect(MONO_FILTER[code]).toBe(name);
    expect(parseMono({ [ADJ.monoFilter]: code }).monochromeFilter).toEqual({ code, name });
  });

  it('refuses a filter code outside the camera list', () => {
    const r = parseMono({ [ADJ.monoFilter]: 0x86 });
    expect(r.monochromeFilter).toEqual({ code: 0x86, name: 'unknown' });
    expect(r.supported).toBe(false);
    expect(r.warnings).toContain('unknown monochrome filter code 134');
  });
});
