import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BinaryReader } from '../src/reader';
import { readAdjustments } from '../src/parse-adjustments';

const here = dirname(fileURLToPath(import.meta.url));
function load(name: string): BinaryReader {
  return new BinaryReader(new Uint8Array(readFileSync(join(here, 'fixtures', name))));
}

describe('readAdjustments (golden)', () => {
  it('PICCON02 -> Neutral, sharpening 2, saturation 0, hue 0, no mono fields', () => {
    const a = readAdjustments(load('PICCON02.NCP'));
    expect(a.basePictureControl.name).toBe('Neutral');
    expect(a.sharpening).toBe(2);
    expect(a.saturation).toBe(0);
    expect(a.hue).toBe(0);
    expect(a.monochromeFilter).toBeNull();
    expect(a.toningType).toBeNull();
    expect(a.toningStrength).toBeNull();
  });

  it('PICCON33 -> Monochrome, sharpening 2, filter 0x83, toning 0x84, strength 2', () => {
    const a = readAdjustments(load('PICCON33.NCP'));
    expect(a.basePictureControl.name).toBe('Monochrome');
    expect(a.sharpening).toBe(2);
    expect(a.monochromeFilter?.code).toBe(0x83);
    expect(a.toningType?.code).toBe(0x84);
    expect(a.toningStrength).toBe(2);
  });
});
