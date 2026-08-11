import { CurveLut } from './curve';
import type { ExportOptions } from './engine';
import type { BaseMode, FilterParams } from './params';
import type { PixelBuffer } from './pixel';

export interface SerializedFilterParams {
  schemaVersion: number;
  baseMode: BaseMode;
  curveEnabled: boolean;
  curve: Float32Array;
  saturation: number;
  hue: number;
  sharpening: number;
  monoFilter: { code: number; weights: readonly [number, number, number] } | null;
  toning: { code: number; strength: number; color: readonly [number, number, number] } | null;
}

function tuple(values: readonly [number, number, number]): [number, number, number] {
  return [values[0], values[1], values[2]];
}

export function serializeFilterParams(params: FilterParams): SerializedFilterParams {
  return {
    schemaVersion: params.schemaVersion,
    baseMode: params.baseMode,
    curveEnabled: params.curveEnabled,
    curve: params.curve.toFloat32Array(),
    saturation: params.saturation,
    hue: params.hue,
    sharpening: params.sharpening,
    monoFilter: params.monoFilter
      ? { code: params.monoFilter.code, weights: tuple(params.monoFilter.weights) }
      : null,
    toning: params.toning
      ? { code: params.toning.code, strength: params.toning.strength, color: tuple(params.toning.color) }
      : null,
  };
}

export function deserializeFilterParams(params: SerializedFilterParams): FilterParams {
  return {
    schemaVersion: params.schemaVersion,
    baseMode: params.baseMode,
    curveEnabled: params.curveEnabled,
    curve: CurveLut.from(Array.from(params.curve)),
    saturation: params.saturation,
    hue: params.hue,
    sharpening: params.sharpening,
    monoFilter: params.monoFilter
      ? { code: params.monoFilter.code, weights: tuple(params.monoFilter.weights) }
      : null,
    toning: params.toning
      ? { code: params.toning.code, strength: params.toning.strength, color: tuple(params.toning.color) }
      : null,
  };
}

export type WorkerMethod = 'load' | 'preview' | 'thumbnail' | 'export' | 'dispose-image';
export type ProgressStage = 'decode' | 'scale' | 'render' | 'encode';

export interface WorkerLoadedImage {
  id: string;
  width: number;
  height: number;
  orientation: number;
  sourceFormat: 'image/jpeg' | 'image/png';
}

export type WorkerRequest =
  | { id: number; method: 'load'; bytes: Uint8Array }
  | {
      id: number;
      method: 'preview';
      imageId: string;
      params: SerializedFilterParams;
      intensity: number;
      maxLongEdge: number;
    }
  | { id: number; method: 'thumbnail'; imageId: string; params: SerializedFilterParams; size: number }
  | { id: number; method: 'export'; imageId: string; params: SerializedFilterParams; options: ExportOptions }
  | { id: number; method: 'dispose-image'; imageId: string };

export type WorkerResponse =
  | { id: number; ok: true; result: WorkerLoadedImage | PixelBuffer | Uint8Array | null }
  | { id: number; ok: false; error: { name: string; message: string } };

export interface WorkerProgress {
  id: number;
  event: 'progress';
  stage: ProgressStage;
  value: number;
}

export interface WorkerFallback {
  event: 'fallback';
  message: string;
}

export type WorkerInboundMessage = WorkerResponse | WorkerProgress | WorkerFallback;
