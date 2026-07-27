import type { FilterParams } from './params';
import { fromUint8Rgba, toUint8Rgba } from './pixel';
import { process } from './pipeline';

export interface RenderableImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Canvas 2D reference path: applies the full filter pipeline to the image's pixels.
 * The WebGL renderer (later plan) must match this within a pixel tolerance (spec §10.2).
 */
export function renderCanvas(image: RenderableImage, params: FilterParams, intensity: number = 1): RenderableImage {
  const input = fromUint8Rgba(image.data, image.width, image.height);
  const out = process(input, params, intensity);
  return { data: toUint8Rgba(out), width: out.width, height: out.height };
}
