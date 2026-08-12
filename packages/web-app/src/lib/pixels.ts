import type { PixelBuffer } from '@easypic/image-engine';

function byte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

export function toImageData(buffer: PixelBuffer): ImageData {
  const data = new Uint8ClampedArray(buffer.data.length);
  for (let index = 0; index < data.length; index++) data[index] = byte(buffer.data[index]);
  return new ImageData(data, buffer.width, buffer.height);
}

export function drawPixelBuffer(canvas: HTMLCanvasElement, buffer: PixelBuffer): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  canvas.width = buffer.width;
  canvas.height = buffer.height;
  context.putImageData(toImageData(buffer), 0, 0);
}
