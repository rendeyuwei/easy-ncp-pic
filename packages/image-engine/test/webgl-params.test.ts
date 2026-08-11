import { describe, expect, it } from 'vitest';
import { CurveLut } from '../src/curve';
import type { FilterParams } from '../src/params';
import { packWebGLParams } from '../src/webgl-params';

const color: FilterParams = {
  schemaVersion: 1,
  baseMode: 'color',
  curveEnabled: true,
  curve: CurveLut.identity(),
  saturation: 2,
  hue: -3,
  sharpening: 4,
  monoFilter: null,
  toning: null,
};

const monochrome: FilterParams = {
  schemaVersion: 1,
  baseMode: 'monochrome',
  curveEnabled: true,
  curve: CurveLut.identity(),
  saturation: 0,
  hue: 0,
  sharpening: 2,
  monoFilter: { code: 0x83, weights: [0.7, 0.3, 0] },
  toning: { code: 0x84, strength: 2, color: [0.7, 0.7, 0.5] },
};

describe('packWebGLParams', () => {
  it('converts color parameters to shader units and clamps intensity', () => {
    const packed = packWebGLParams(color, 2);

    expect(packed).toMatchObject({
      monochrome: 0,
      saturation: 2,
      hueDegrees: -15,
      sharpeningAmount: 0.6,
      intensity: 1,
      hasToning: 0,
      toningMix: 0,
    });
    expect(packed.monoWeights).toEqual([0.2126, 0.7152, 0.0722]);
    expect(packed.toningColor).toEqual([0, 0, 0]);
    expect(packed.curve).toHaveLength(257);
  });

  it('packs monochrome filter and toning values', () => {
    const packed = packWebGLParams(monochrome, -1);

    expect(packed).toMatchObject({
      monochrome: 1,
      hasToning: 1,
      toningMix: 0.2,
      intensity: 0,
      sharpeningAmount: 0.3,
    });
    expect(packed.monoWeights).toEqual([0.7, 0.3, 0]);
    expect(packed.toningColor).toEqual([0.7, 0.7, 0.5]);
  });

  it('returns curve storage independent from the source LUT', () => {
    const packed = packWebGLParams(color, 1);
    packed.curve[128] = 0;

    expect(color.curve.apply(0.5)).toBeCloseTo(0.5, 6);
  });
});
