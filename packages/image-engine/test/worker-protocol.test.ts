import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNcp } from '@easypic/ncp-parser';
import { CurveLut } from '../src/curve';
import { fromParsedPictureControl, type FilterParams } from '../src/params';
import { deserializeFilterParams, serializeFilterParams } from '../src/worker-protocol';

const here = dirname(fileURLToPath(import.meta.url));

function fixture(name: string): FilterParams {
  const bytes = new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures', name)));
  return fromParsedPictureControl(parseNcp(bytes));
}

describe('worker FilterParams serialization', () => {
  for (const name of ['PICCON02.NCP', 'PICCON33.NCP']) {
    it(`round-trips every filter value from ${name}`, () => {
      const source = fixture(name);
      const serialized = serializeFilterParams(source);
      const restored = deserializeFilterParams(serialized);

      expect(serialized.curve).toBeInstanceOf(Float32Array);
      expect(serialized.curve).not.toBeInstanceOf(CurveLut);
      expect(restored).toMatchObject({
        schemaVersion: source.schemaVersion,
        baseMode: source.baseMode,
        curveEnabled: source.curveEnabled,
        saturation: source.saturation,
        hue: source.hue,
        sharpening: source.sharpening,
        monoFilter: source.monoFilter,
        toning: source.toning,
      });
      for (let index = 0; index <= 256; index++) {
        const input = index / 256;
        expect(restored.curve.apply(input)).toBeCloseTo(source.curve.apply(input), 7);
      }
    });
  }

  it('does not expose source LUT storage through the serialized value', () => {
    const source = fixture('PICCON02.NCP');
    const serialized = serializeFilterParams(source);
    serialized.curve[128] = 0;

    expect(source.curve.apply(0.5)).not.toBe(0);
  });
});
