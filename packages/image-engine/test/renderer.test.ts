import { describe, expect, it } from 'vitest';
import { CurveLut } from '../src/curve';
import type { FilterParams } from '../src/params';
import type { RenderableImage } from '../src/render-canvas';
import { canvasRenderer, createFallbackRenderer, type ImageRenderer } from '../src/renderer';

const identityParams: FilterParams = {
  schemaVersion: 1,
  baseMode: 'color',
  curveEnabled: false,
  curve: CurveLut.identity(),
  saturation: 0,
  hue: 0,
  sharpening: 0,
  monoFilter: null,
  toning: null,
};

const input: RenderableImage = {
  width: 1,
  height: 1,
  data: new Uint8ClampedArray([20, 40, 60, 255]),
};

function solidRenderer(kind: 'webgl' | 'canvas', rgba: readonly [number, number, number, number]): ImageRenderer {
  return {
    kind,
    render(image) {
      const data = new Uint8ClampedArray(image.width * image.height * 4);
      for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
      return { width: image.width, height: image.height, data };
    },
  };
}

describe('renderer boundary', () => {
  it('keeps the Canvas reference path available through the renderer interface', () => {
    const output = canvasRenderer.render(input, identityParams, 1);
    expect(Array.from(output.data)).toEqual([20, 40, 60, 255]);
  });

  it('permanently switches to Canvas after the primary renderer fails', () => {
    const primaryOutput = solidRenderer('webgl', [200, 0, 0, 255]);
    let failPrimary = false;
    const primary: ImageRenderer = {
      kind: 'webgl',
      render(image, params, intensity) {
        if (failPrimary) throw new Error('context lost');
        return primaryOutput.render(image, params, intensity);
      },
    };
    const fallback = solidRenderer('canvas', [0, 0, 200, 255]);
    const errors: unknown[] = [];
    const renderer = createFallbackRenderer(primary, fallback, (error) => errors.push(error));

    expect(Array.from(renderer.render(input, identityParams).data)).toEqual([200, 0, 0, 255]);
    failPrimary = true;
    expect(Array.from(renderer.render(input, identityParams).data)).toEqual([0, 0, 200, 255]);
    failPrimary = false;
    expect(Array.from(renderer.render(input, identityParams).data)).toEqual([0, 0, 200, 255]);
    expect(renderer.kind).toBe('canvas');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(new Error('context lost'));
  });

  it('disposes each renderer at most once after fallback', () => {
    let primaryDisposals = 0;
    let fallbackDisposals = 0;
    const primary: ImageRenderer = {
      kind: 'webgl',
      render() {
        throw new Error('context lost');
      },
      dispose() {
        primaryDisposals++;
      },
    };
    const fallback: ImageRenderer = {
      ...solidRenderer('canvas', [0, 0, 0, 255]),
      dispose() {
        fallbackDisposals++;
      },
    };
    const renderer = createFallbackRenderer(primary, fallback);

    renderer.render(input, identityParams);
    renderer.dispose?.();
    renderer.dispose?.();

    expect(primaryDisposals).toBe(1);
    expect(fallbackDisposals).toBe(1);
  });
});
