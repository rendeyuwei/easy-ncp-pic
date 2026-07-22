import type { PixelBuffer } from './pixel';
import { createPixelBuffer } from './pixel';
import { clamp01 } from './color';

/** Blend original <-> filtered by intensity (clamped to [0,1]; 1 = fully filtered, the default). */
export function blendByIntensity(original: PixelBuffer, filtered: PixelBuffer, intensity: number): PixelBuffer {
  if (original.width !== filtered.width || original.height !== filtered.height) {
    throw new Error('blendByIntensity: dimension mismatch');
  }
  const t = clamp01(intensity);
  const out = createPixelBuffer(original.width, original.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = original.data[i] * (1 - t) + filtered.data[i] * t;
  }
  return out;
}
