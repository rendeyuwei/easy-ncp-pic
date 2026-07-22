import type { PixelBuffer } from './pixel';
import { clonePixelBuffer } from './pixel';
import type { FilterParams } from './params';
import { clamp01, REC709 } from './color';
import { applySaturation, applyHue } from './adjust';
import { monoToGray, applyToning } from './mono';
import { sharpen } from './sharpen';
import { blendByIntensity } from './blend';

/**
 * Apply the full filter chain (spec §10.2 order):
 *   curve -> saturation & hue -> monochrome filter & toning (if mono) -> sharpen -> clamp
 * then blend with the original by intensity (default 1 = fully filtered).
 * Works in float; clamps to [0,1] only at the end. Does not mutate `input`.
 */
export function process(input: PixelBuffer, params: FilterParams, intensity: number = 1): PixelBuffer {
  const original = input;
  const work = clonePixelBuffer(input);
  const { data } = work;

  // 1) 257-point curve (same master curve on R,G,B).
  for (let i = 0; i < data.length; i += 4) {
    data[i] = params.curve.apply(data[i]);
    data[i + 1] = params.curve.apply(data[i + 1]);
    data[i + 2] = params.curve.apply(data[i + 2]);
  }

  // 2) Saturation & hue.
  for (let i = 0; i < data.length; i += 4) {
    let [r, g, b] = applySaturation(data[i], data[i + 1], data[i + 2], params.saturation);
    [r, g, b] = applyHue(r, g, b, params.hue);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  // 3) Monochrome filter & toning (collapse to grayscale, then tint) — color mode is a no-op.
  if (params.baseMode === 'monochrome') {
    const weights = params.monoFilter?.weights ?? REC709;
    for (let i = 0; i < data.length; i += 4) {
      const gray = monoToGray(data[i], data[i + 1], data[i + 2], weights);
      if (params.toning) {
        const [tr, tg, tb] = applyToning(gray, params.toning.color, params.toning.strength);
        data[i] = tr;
        data[i + 1] = tg;
        data[i + 2] = tb;
      } else {
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
    }
  }

  // 4) Sharpen (limited unsharp mask).
  const sharpened = sharpen(work, params.sharpening);

  // 5) Clamp to [0,1] at the output.
  for (let i = 0; i < sharpened.data.length; i += 4) {
    sharpened.data[i] = clamp01(sharpened.data[i]);
    sharpened.data[i + 1] = clamp01(sharpened.data[i + 1]);
    sharpened.data[i + 2] = clamp01(sharpened.data[i + 2]);
  }

  // 6) Blend with the original by intensity.
  return blendByIntensity(original, sharpened, intensity);
}
