import { clamp01, REC709 } from './color';
import type { FilterParams } from './params';

export interface PackedWebGLParams {
  curve: Float32Array;
  saturation: number;
  hueDegrees: number;
  monochrome: 0 | 1;
  monoWeights: readonly [number, number, number];
  hasToning: 0 | 1;
  toningColor: readonly [number, number, number];
  toningMix: number;
  sharpeningAmount: number;
  intensity: number;
}

const NO_TONING: readonly [number, number, number] = [0, 0, 0];

export function packWebGLParams(params: FilterParams, intensity: number): PackedWebGLParams {
  return {
    curve: params.curve.toFloat32Array(),
    saturation: params.saturation,
    hueDegrees: params.hue * 5,
    monochrome: params.baseMode === 'monochrome' ? 1 : 0,
    monoWeights: params.monoFilter?.weights ?? REC709,
    hasToning: params.toning ? 1 : 0,
    toningColor: params.toning?.color ?? NO_TONING,
    toningMix: params.toning ? clamp01(params.toning.strength * 0.1) : 0,
    sharpeningAmount: params.sharpening * 0.15,
    intensity: clamp01(intensity),
  };
}
