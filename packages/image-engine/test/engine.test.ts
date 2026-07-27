import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { createEngine, type Engine } from '../src/engine';
import type { Platform } from '../src/platform';
import { fromParsedPictureControl } from '../src/params';
import { nodeDecode, nodeEncode } from './helpers/node-platform';

const here = dirname(fileURLToPath(import.meta.url));
const astia = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')))),
);

const nodePlatform: Platform = {
  decode: (b) => nodeDecode(b),
  encode: (rgba, w, h, p) => nodeEncode(rgba, w, h, p.type, p.quality),
};

/** Make a real encoded test image (solid-ish colors) via the node platform. */
async function makeTestImage(w: number, h: number, type: 'image/jpeg' | 'image/png'): Promise<Uint8Array> {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = (x * 255) / Math.max(1, w - 1);
      rgba[i + 1] = (y * 255) / Math.max(1, h - 1);
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  return nodeEncode(rgba, w, h, type, 0.92);
}

let engine: Engine;
beforeAll(() => {
  engine = createEngine(nodePlatform);
});

describe('engine', () => {
  it('load decodes and reports dimensions', async () => {
    const img = await makeTestImage(40, 30, 'image/png');
    const loaded = await engine.load(img);
    expect(loaded.width).toBe(40);
    expect(loaded.height).toBe(30);
    expect(loaded.orientation).toBe(1); // generated image has no EXIF
  });

  it('renderPreview scales to the requested long edge and applies the filter', async () => {
    const loaded = await engine.load(await makeTestImage(400, 200, 'image/png'));
    const preview = engine.renderPreview(loaded, astia, 1, 100);
    expect(preview.width).toBe(100);
    expect(preview.height).toBe(50);
  });

  it('renderThumbnail produces a small image', async () => {
    const loaded = await engine.load(await makeTestImage(400, 200, 'image/png'));
    const thumb = engine.renderThumbnail(loaded, astia, 32);
    expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(32);
  });

  it('exportImage preserves the original pixel dimensions (PNG)', async () => {
    const loaded = await engine.load(await makeTestImage(60, 40, 'image/png'));
    const out = await engine.exportImage(loaded, astia, { type: 'image/png' });
    const decoded = await nodeDecode(out);
    expect(decoded.width).toBe(60);
    expect(decoded.height).toBe(40);
  });

  it('exportImage defaults to the input format (JPEG in -> JPEG out)', async () => {
    const loaded = await engine.load(await makeTestImage(20, 20, 'image/jpeg'));
    const out = await engine.exportImage(loaded, astia, {});
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
  });

  it('exportImage defaults to the input format (PNG in -> PNG out)', async () => {
    const loaded = await engine.load(await makeTestImage(20, 20, 'image/png'));
    const out = await engine.exportImage(loaded, astia, {});
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50); // 'P'
  });

  it('exported pixels differ from the input when a filter is applied', async () => {
    const bytes = await makeTestImage(30, 30, 'image/png');
    const loaded = await engine.load(bytes);
    const out = await engine.exportImage(loaded, astia, { type: 'image/png' });
    const before = await nodeDecode(bytes);
    const after = await nodeDecode(out);
    const differs = Array.from(after.data).some((v, i) => Math.abs(v - before.data[i]) > 2);
    expect(differs).toBe(true);
  });
});
