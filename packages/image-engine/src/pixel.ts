/** RGBA pixels in a Float32Array, each channel in [0,1] (intermediates may exceed; clamp at output). */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Float32Array; // length = width * height * 4
}

export function createPixelBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Float32Array(width * height * 4) };
}

export function clonePixelBuffer(buf: PixelBuffer): PixelBuffer {
  return { width: buf.width, height: buf.height, data: buf.data.slice() };
}

export function fromUint8Rgba(data: Uint8ClampedArray | Uint8Array, width: number, height: number): PixelBuffer {
  const out = new Float32Array(width * height * 4);
  for (let i = 0; i < out.length; i++) out[i] = data[i] / 255;
  return { width, height, data: out };
}

export function toUint8Rgba(buf: PixelBuffer): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf.data.length);
  for (let i = 0; i < buf.data.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, buf.data[i])) * 255);
  return out;
}
