import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { fromParsedPictureControl } from '../src/params';

const here = dirname(fileURLToPath(import.meta.url));
function parsed(name: string) {
  return parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures', name))));
}

describe('fromParsedPictureControl', () => {
  it('PICCON02 -> color mode, curve enabled, zero sat/hue, no mono', () => {
    const params = fromParsedPictureControl(parsed('PICCON02.NCP'));
    expect(params.baseMode).toBe('color');
    expect(params.curve.size).toBe(257);
    expect(params.curveEnabled).toBe(true);
    expect(params.saturation).toBe(0);
    expect(params.hue).toBe(0);
    expect(params.sharpening).toBe(2);
    expect(params.monoFilter).toBeNull();
    expect(params.toning).toBeNull();
  });

  it('PICCON33 -> monochrome mode with filter 0x83 and toning 0x84 (strength 2)', () => {
    const params = fromParsedPictureControl(parsed('PICCON33.NCP'));
    expect(params.baseMode).toBe('monochrome');
    expect(params.monoFilter?.code).toBe(0x83);
    expect(params.toning?.code).toBe(0x84);
    expect(params.toning?.strength).toBe(2);
    expect(params.sharpening).toBe(2);
  });

  it('disabled curve falls back to an identity LUT', () => {
    const p = parsed('PICCON02.NCP');
    const disabled = { ...p, customCurve: { ...p.customCurve, enabled: false } };
    const params = fromParsedPictureControl(disabled);
    expect(params.curveEnabled).toBe(false);
    expect(params.curve.apply(0.5)).toBeCloseTo(0.5, 6);
  });
});
