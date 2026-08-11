import type { PixelBuffer } from './pixel';
import { createPixelBuffer, clonePixelBuffer } from './pixel';

/**
 * Apply an EXIF orientation (1–8) to a pixel buffer, returning a new buffer.
 * Orientations 5–8 swap width/height. Orientation 1 / unknown returns a clone.
 */
export function applyOrientationToBuffer(buf: PixelBuffer, orientation: number): PixelBuffer {
  const o = orientation < 1 || orientation > 8 ? 1 : orientation;
  if (o === 1) return clonePixelBuffer(buf);

  const { width: W, height: H, data } = buf;
  const swap = o >= 5;
  const outW = swap ? H : W;
  const outH = swap ? W : H;
  const out = createPixelBuffer(outW, outH);

  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      let dx: number;
      let dy: number;
      switch (o) {
        case 2: dx = W - 1 - sx; dy = sy; break;          // mirror horizontal
        case 3: dx = W - 1 - sx; dy = H - 1 - sy; break;   // rotate 180
        case 4: dx = sx; dy = H - 1 - sy; break;           // mirror vertical
        case 5: dx = sy; dy = sx; break;                   // transpose
        case 6: dx = H - 1 - sy; dy = sx; break;           // rotate 90 CW
        case 7: dx = H - 1 - sy; dy = W - 1 - sx; break;   // transverse
        case 8: dx = sy; dy = W - 1 - sx; break;           // rotate 270 CW
        default: dx = sx; dy = sy;
      }
      const si = (sy * W + sx) * 4;
      const di = (dy * outW + dx) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}
