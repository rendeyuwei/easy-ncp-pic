import type { PixelBuffer } from './pixel';
import { createPixelBuffer, clonePixelBuffer } from './pixel';

/**
 * Nearest-neighbor resize (v1). Adequate for previews/thumbnails; a higher-quality
 * resampler can replace this later without changing the interface.
 */
export function scaleBuffer(buf: PixelBuffer, outW: number, outH: number): PixelBuffer {
  if (outW === buf.width && outH === buf.height) return clonePixelBuffer(buf);
  const out = createPixelBuffer(outW, outH);
  const xRatio = buf.width / outW;
  const yRatio = buf.height / outH;
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(buf.height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(buf.width - 1, Math.floor(x * xRatio));
      const si = (sy * buf.width + sx) * 4;
      const di = (y * outW + x) * 4;
      out.data[di] = buf.data[si];
      out.data[di + 1] = buf.data[si + 1];
      out.data[di + 2] = buf.data[si + 2];
      out.data[di + 3] = buf.data[si + 3];
    }
  }
  return out;
}
