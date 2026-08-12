import { describe, expect, it, vi } from 'vitest';
import type { PixelBuffer } from '@easypic/image-engine';
import { drawPixelBuffer, toImageData } from '../lib/pixels';

const pixels: PixelBuffer = {
  width: 2,
  height: 1,
  data: new Float32Array([0, 0.5, 1.2, 1, -0.2, 0.25, 0.75, 0.5]),
};

describe('pixel presentation', () => {
  it('rounds and clamps float pixels into ImageData bytes', () => {
    const image = toImageData(pixels);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(Array.from(image.data)).toEqual([0, 128, 255, 255, 0, 64, 191, 128]);
  });

  it('sizes the canvas and writes pixels at the origin', () => {
    const putImageData = vi.fn();
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue({ putImageData } as unknown as CanvasRenderingContext2D);

    drawPixelBuffer(canvas, pixels);

    expect([canvas.width, canvas.height]).toEqual([2, 1]);
    expect(putImageData).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 1 }), 0, 0);
  });

  it('fails clearly when Canvas 2D is unavailable', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getContext').mockReturnValue(null);
    expect(() => drawPixelBuffer(canvas, pixels)).toThrow('Canvas 2D is unavailable');
  });
});
