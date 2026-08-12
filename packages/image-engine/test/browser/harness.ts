import { parseNcp } from '@easypic/ncp-parser';
import { CurveLut } from '../../src/curve';
import { createEngine } from '../../src/engine';
import { fromParsedPictureControl } from '../../src/params';
import { browserPlatform } from '../../src/platform';
import { renderCanvas, type RenderableImage } from '../../src/render-canvas';
import { createBrowserRenderer, createWebGLRenderer } from '../../src/render-webgl';
import { createWorkerEngine } from '../../src/worker-client';

export interface ParityResult {
  webgl2: boolean;
  cases: Array<{ name: string; maxDelta: number; meanDelta: number }>;
}

export interface FallbackResult {
  fallbackCount: number;
  kind: string;
  exactCanvasMatch: boolean;
}

export interface WorkerRoundTripResult {
  loaded: { width: number; height: number; sourceFormat: string };
  preview: { width: number; height: number; changed: boolean };
  exported: { width: number; height: number; byteLength: number };
  progress: Record<string, number[]>;
}

export interface CanvasWorkerResult {
  width: number;
  height: number;
  exactCanvasMatch: boolean;
}

declare global {
  interface Window {
    easyPicHarness: {
      runWebGLParity(): Promise<ParityResult>;
      runForcedFallback(): Promise<FallbackResult>;
      runWorkerRoundTrip(): Promise<WorkerRoundTripResult>;
      runCanvasWorkerParity(): Promise<CanvasWorkerResult>;
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

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const image = context.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      image.data[index] = (x * 7 + y * 3) % 256;
      image.data[index + 1] = (x * 5 + y * 11) % 256;
      image.data[index + 2] = x < width / 2 ? 40 : 220;
      image.data[index + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
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

  async runWorkerRoundTrip() {
    const worker = new Worker(new URL('../../src/worker-runtime.ts', import.meta.url), {
      type: 'module',
      name: 'easypic-browser-test',
    });
    const runtimeFailure = new Promise<never>((_, reject) => {
      worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true });
    });
    const engine = createWorkerEngine(worker);
    const bytes = await makePng(64, 48);
    const params = await loadParams('PICCON02.NCP');
    const progress: Record<string, number[]> = { load: [], preview: [], export: [] };
    try {
      const loaded = await Promise.race([
        engine.load(bytes, {
          onProgress: ({ value }) => progress.load.push(value),
        }),
        runtimeFailure,
      ]);
      const preview = await engine.renderPreview(loaded, params, 1, 32, {
        onProgress: ({ value }) => progress.preview.push(value),
      });
      const direct = createEngine(browserPlatform);
      const directLoaded = await direct.load(bytes);
      const original = direct.renderPreview(
        directLoaded,
        {
          schemaVersion: 1,
          baseMode: 'color',
          curveEnabled: false,
          curve: CurveLut.identity(),
          saturation: 0,
          hue: 0,
          sharpening: 0,
          monoFilter: null,
          toning: null,
        },
        1,
        32,
      );
      const changed = preview.data.some((value, index) => Math.abs(value - original.data[index]) > 0.01);
      const exported = await engine.exportImage(loaded, params, { type: 'image/png' }, {
        onProgress: ({ value }) => progress.export.push(value),
      });
      const bitmap = await createImageBitmap(new Blob([exported as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
      const result: WorkerRoundTripResult = {
        loaded: { width: loaded.width, height: loaded.height, sourceFormat: loaded.sourceFormat },
        preview: { width: preview.width, height: preview.height, changed },
        exported: { width: bitmap.width, height: bitmap.height, byteLength: exported.byteLength },
        progress,
      };
      bitmap.close();
      await engine.disposeImage(loaded);
      return result;
    } finally {
      engine.dispose();
    }
  },

  async runCanvasWorkerParity() {
    const worker = new Worker(new URL('./canvas-worker-runtime.ts', import.meta.url), {
      type: 'module',
      name: 'easypic-canvas-worker-test',
    });
    const runtimeFailure = new Promise<never>((_, reject) => {
      worker.addEventListener('error', (event) => reject(new Error(event.message)), { once: true });
    });
    const engine = createWorkerEngine(worker);
    const bytes = await makePng(16, 12);
    const params = await loadParams('PICCON33.NCP');
    try {
      const loaded = await Promise.race([engine.load(bytes), runtimeFailure]);
      const actual = await engine.renderPreview(loaded, params, 0.5, 8);
      const direct = createEngine(browserPlatform);
      const directLoaded = await direct.load(bytes);
      const expected = direct.renderPreview(directLoaded, params, 0.5, 8);
      return {
        width: actual.width,
        height: actual.height,
        exactCanvasMatch: actual.data.every((value, index) => value === expected.data[index]),
      };
    } finally {
      engine.dispose();
    }
  },
};
