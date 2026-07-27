import type { ParsedPictureControl } from '@easypic/ncp-parser';
import { CurveLut } from './curve';
import { filterWeightsFor, toningColorFor } from './mono';

export type BaseMode = 'color' | 'monochrome';

export interface MonoFilterParams {
  code: number;
  weights: readonly [number, number, number];
}

export interface ToningParams {
  code: number;
  strength: number;
  color: readonly [number, number, number];
}

/** Renderer-agnostic filter parameter model shared by the Canvas and WebGL paths (spec §5.4). */
export interface FilterParams {
  schemaVersion: number;
  baseMode: BaseMode;
  curveEnabled: boolean;
  curve: CurveLut;
  saturation: number; // NCP 0x80-centered value
  hue: number; // NCP 0x80-centered value
  sharpening: number; // NCP value
  monoFilter: MonoFilterParams | null;
  toning: ToningParams | null;
}

export function fromParsedPictureControl(parsed: ParsedPictureControl): FilterParams {
  const baseMode: BaseMode = parsed.basePictureControl.name === 'Monochrome' ? 'monochrome' : 'color';
  const curveEnabled = parsed.customCurve.enabled;
  const curve = curveEnabled ? CurveLut.from(parsed.customCurve.lut257) : CurveLut.identity();

  let monoFilter: MonoFilterParams | null = null;
  let toning: ToningParams | null = null;
  if (baseMode === 'monochrome') {
    if (parsed.monochromeFilter) {
      monoFilter = { code: parsed.monochromeFilter.code, weights: filterWeightsFor(parsed.monochromeFilter.code) };
    }
    if (parsed.toningType) {
      const color = toningColorFor(parsed.toningType.code);
      if (color) {
        toning = { code: parsed.toningType.code, strength: parsed.toningStrength ?? 0, color };
      }
    }
  }

  return {
    schemaVersion: parsed.schemaVersion,
    baseMode,
    curveEnabled,
    curve,
    saturation: parsed.saturation,
    hue: parsed.hue,
    sharpening: parsed.sharpening,
    monoFilter,
    toning,
  };
}
