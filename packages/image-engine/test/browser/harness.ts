import { parseNcp } from '@easypic/ncp-parser';
import { fromParsedPictureControl } from '../../src/params';
import { renderCanvas, type RenderableImage } from '../../src/render-canvas';
import { createBrowserRenderer, createWebGLRenderer } from '../../src/render-webgl';

export interface ParityResult {
  webgl2: boolean;
  cases: Array<{ name: string; maxDelta: number; meanDelta: number }>;
}

export interface FallbackResult {
  fallbackCount: number;
  kind: string;
  exactCanvasMatch: boolean;
}

declare global {
  interface Window {
    easyPicHarness: {
      runWebGLParity(): Promise<ParityResult>;
      runForcedFallback(): Promise<FallbackResult>;
    };
  }
}

function makeFixture(width = 17, height = 13): RenderableImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = x < Math.floor(width / 2) ? x * 11 : 255 - x * 7;
      data[i + 1] = y < Math.floor(height / 2) ? y * 17 : 255 - y * 9;
      data[i + 2] = (x * 29 + y * 13) % 256;
      data[i + 3] = 80 + ((x * 19 + y * 23) % 176);
    }
  }
  return { data, width, height };
}

async function loadParams(name: 'PICCON02.NCP' | 'PICCON33.NCP') {
  const url = new URL(`../../../ncp-parser/test/fixtures/${name}`, import.meta.url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load ${name}: ${response.status}`);
  return fromParsedPictureControl(parseNcp(new Uint8Array(await response.arrayBuffer())));
}

function delta(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let maxDelta = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const value = Math.abs(a[i] - b[i]);
    maxDelta = Math.max(maxDelta, value);
    total += value;
  }
  return { maxDelta, meanDelta: total / a.length };
}

window.easyPicHarness = {
  async runWebGLParity() {
    const image = makeFixture();
    const renderer = createWebGLRenderer();
    const filters = [
      ['color', await loadParams('PICCON02.NCP')],
      ['monochrome', await loadParams('PICCON33.NCP')],
    ] as const;
    const cases: ParityResult['cases'] = [];
    try {
      for (const [name, params] of filters) {
        for (const intensity of [0, 0.5, 1]) {
          const reference = renderCanvas(image, params, intensity);
          const actual = renderer.render(image, params, intensity);
          cases.push({ name: `${name}-${intensity}`, ...delta(reference.data, actual.data) });
        }
      }
      return { webgl2: renderer.kind === 'webgl', cases };
    } finally {
      renderer.dispose?.();
    }
  },

  async runForcedFallback() {
    const image = makeFixture(3, 2);
    const params = await loadParams('PICCON02.NCP');
    const errors: unknown[] = [];
    const renderer = createBrowserRenderer({
      canvasFactory() {
        throw new Error('webgl disabled');
      },
      onFallback(error) {
        errors.push(error);
      },
    });
    const expected = renderCanvas(image, params, 0.5);
    const first = renderer.render(image, params, 0.5);
    const second = renderer.render(image, params, 0.5);
    return {
      fallbackCount: errors.length,
      kind: renderer.kind,
      exactCanvasMatch:
        Array.from(first.data).every((value, index) => value === expected.data[index]) &&
        Array.from(second.data).every((value, index) => value === expected.data[index]),
    };
  },
};
