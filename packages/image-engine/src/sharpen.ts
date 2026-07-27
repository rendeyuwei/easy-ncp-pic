import type { PixelBuffer } from './pixel';
import { createPixelBuffer } from './pixel';

const DETAIL_CLAMP = 0.5; // limits halos (spec §10.2)

/**
 * Limited 3x3 Unsharp Mask. amount = sharpeningValue * 0.15. Per-channel detail
 * (original - box-blur) is clamped to +-DETAIL_CLAMP before being added back.
 * Alpha is left untouched.
 */
export function sharpen(buf: PixelBuffer, sharpeningValue: number): PixelBuffer {
  const amount = sharpeningValue * 0.15;
  if (amount === 0) {
    return { width: buf.width, height: buf.height, data: buf.data.slice() };
  }
  const { width: w, height: h, data } = buf;
  const out = createPixelBuffer(w, h);

  const at = (x: number, y: number, c: number): number => {
    const xx = Math.min(w - 1, Math.max(0, x));
    const yy = Math.min(h - 1, Math.max(0, y));
    return data[(yy * w + xx) * 4 + c];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = data[idx + c];
        const blur =
          (at(x - 1, y - 1, c) + at(x, y - 1, c) + at(x + 1, y - 1, c) +
            at(x - 1, y, c) + center + at(x + 1, y, c) +
            at(x - 1, y + 1, c) + at(x, y + 1, c) + at(x + 1, y + 1, c)) /
          9;
        let detail = center - blur;
        if (detail > DETAIL_CLAMP) detail = DETAIL_CLAMP;
        else if (detail < -DETAIL_CLAMP) detail = -DETAIL_CLAMP;
        out.data[idx + c] = center + amount * detail;
      }
      out.data[idx + 3] = data[idx + 3]; // preserve alpha
    }
  }
  return out;
}
