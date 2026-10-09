import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BinaryReader } from '../src/reader';
import { readAdjustments } from '../src/parse-adjustments';
import { ADJ } from '../src/constants';
import { buildNcp } from './helpers/build-ncp';
import { adjustmentRegion } from './helpers/adjustment-region';

const here = dirname(fileURLToPath(import.meta.url));
function load(name: string): BinaryReader {
  return new BinaryReader(new Uint8Array(readFileSync(join(here, 'fixtures', name))));
}

/** Synthetic adjustments region, read back through readAdjustments(). */
function synth(baseCode: number, patches: Record<number, number> = {}): ReturnType<typeof readAdjustments> {
  return readAdjustments(new BinaryReader(buildNcp({ baseCode, adjustments: adjustmentRegion(patches) })));
}

describe('readAdjustments (golden)', () => {
  it('PICCON02 -> Neutral (0x03c2), sharpening 2, saturation 0, hue 0, no mono fields', () => {
    const a = readAdjustments(load('PICCON02.NCP'));
    expect(a.basePictureControl).toEqual({ code: 0x03c2, name: 'Neutral' });
    expect(a.sharpening).toBe(2);
    expect(a.contrast).toEqual({ mode: 'curve', value: 0 });
    expect(a.brightness).toEqual({ mode: 'curve', value: 0 });
    expect(a.saturation).toBe(0);
    expect(a.hue).toBe(0);
    expect(a.monochromeFilter).toBeNull();
    expect(a.toningType).toBeNull();
    expect(a.toningStrength).toBeNull();
    expect(a.warnings).toEqual([]);
  });

  it('PICCON33 -> Monochrome (0x064d), sharpening 2, filter 0x83, toning 0x84, strength 2', () => {
    const a = readAdjustments(load('PICCON33.NCP'));
    expect(a.basePictureControl).toEqual({ code: 0x064d, name: 'Monochrome' });
    expect(a.sharpening).toBe(2);
    expect(a.contrast).toEqual({ mode: 'curve', value: 0 });
    expect(a.brightness).toEqual({ mode: 'curve', value: 0 });
    expect(a.monochromeFilter?.code).toBe(0x83);
    expect(a.toningType?.code).toBe(0x84);
    expect(a.toningStrength).toBe(2);
    expect(a.warnings).toEqual([]);
  });
});

describe('readAdjustments (contrast/brightness)', () => {
  it('maps 0x01 to "the custom curve controls this axis" and 0x00 to auto', () => {
    expect(synth(0x03c2, { [ADJ.contrast]: 0x01, [ADJ.brightness]: 0x00 })).toMatchObject({
      contrast: { mode: 'curve', value: 0 },
      brightness: { mode: 'auto', value: 0 },
    });
  });

  it('treats every other byte as 0x80-centered', () => {
    expect(synth(0x03c2, { [ADJ.contrast]: 0x82, [ADJ.brightness]: 0x7d }).contrast).toEqual({ mode: 'value', value: 2 });
    expect(synth(0x03c2, { [ADJ.contrast]: 0x82, [ADJ.brightness]: 0x7d }).brightness).toEqual({ mode: 'value', value: -3 });
    expect(synth(0x03c2, { [ADJ.contrast]: 0x80 }).contrast).toEqual({ mode: 'value', value: 0 });
  });

  it('never warns about curve- or auto-controlled contrast/brightness (the engine reads the LUT)', () => {
    expect(synth(0x03c2, { [ADJ.contrast]: 0x00, [ADJ.brightness]: 0x01 }).warnings).toEqual([]);
  });
});

describe('readAdjustments (auto sharpening/saturation)', () => {
  it('decodes an Auto (0x00) sharpening byte as 0 and records a warning', () => {
    const a = synth(0x03c2, { [ADJ.sharpening]: 0x00 });
    expect(a.sharpening).toBe(0);
    expect(a.warnings).toContain('auto sharpening approximated as 0');
  });

  it('decodes an Auto (0x00) saturation byte as 0 and records a warning', () => {
    const a = synth(0x03c2, { [ADJ.saturation]: 0x00 });
    expect(a.saturation).toBe(0);
    expect(a.warnings).toContain('auto saturation approximated as 0');
  });

  it('keeps 0x80-centered sharpening/saturation warning-free', () => {
    const a = synth(0x03c2, { [ADJ.sharpening]: 0x82, [ADJ.saturation]: 0x7f });
    expect(a.sharpening).toBe(2);
    expect(a.saturation).toBe(-1);
    expect(a.warnings).toEqual([]);
  });
});
