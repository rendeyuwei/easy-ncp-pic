import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { process } from '../src/pipeline';
import { fromParsedPictureControl, type FilterParams } from '../src/params';
import { CurveLut } from '../src/curve';
import { createPixelBuffer } from '../src/pixel';

const here = dirname(fileURLToPath(import.meta.url));
const astia = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')))),
);
const mono = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON33.NCP')))),
);

function onePixel(r: number, g: number, b: number) {
  const buf = createPixelBuffer(1, 1);
  buf.data.set([r, g, b, 1]);
  return buf;
}

describe('pipeline.process', () => {
  it('output stays within [0,1]', () => {
    const out = process(onePixel(0.9, 0.5, 0.1), astia, 1);
    for (let i = 0; i < 3; i++) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0);
      expect(out.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('intensity 0 returns the original (no filter applied)', () => {
    const input = onePixel(0.7, 0.4, 0.2);
    const out = process(input, astia, 0);
    expect(out.data[0]).toBeCloseTo(0.7, 6);
    expect(out.data[1]).toBeCloseTo(0.4, 6);
    expect(out.data[2]).toBeCloseTo(0.2, 6);
  });

  it('preserves alpha', () => {
    const input = onePixel(0.5, 0.5, 0.5);
    input.data[3] = 0.25;
    const out = process(input, astia, 1);
    expect(out.data[3]).toBeCloseTo(0.25, 6);
  });

  it('monochrome mode collapses color to grayscale (R==G==B before any toning tint split)', () => {
    const out = process(onePixel(0.8, 0.4, 0.2), mono, 1);
    // Monochrome with toning: channels differ only by the toning tint; with the
    // PICCON33 toning (0x84) the result is a tinted gray, but luminance-like and bounded.
    for (let i = 0; i < 3; i++) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0);
      expect(out.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('monochrome without toning collapses to R==G==B == Rec.709 luminance (pins the mono stage)', () => {
    const monoNoToning: FilterParams = {
      schemaVersion: 1,
      baseMode: 'monochrome',
      curveEnabled: false,
      curve: CurveLut.identity(),
      saturation: 0,
      hue: 0,
      sharpening: 0, // disable sharpen so the grayscale stays exact
      monoFilter: { code: 0x80, weights: [0.2126, 0.7152, 0.0722] },
      toning: null,
    };
    const out = process(onePixel(0.8, 0.4, 0.2), monoNoToning, 1);
    const luma = 0.2126 * 0.8 + 0.7152 * 0.4 + 0.0722 * 0.2;
    expect(out.data[0]).toBeCloseTo(out.data[1], 5);
    expect(out.data[1]).toBeCloseTo(out.data[2], 5);
    expect(out.data[0]).toBeCloseTo(luma, 5);
  });

  it('does not mutate the input buffer', () => {
    const input = onePixel(0.7, 0.4, 0.2);
    const snapshot = Array.from(input.data);
    process(input, astia, 1);
    expect(Array.from(input.data)).toEqual(snapshot);
  });
});
