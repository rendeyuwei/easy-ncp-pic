import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseNcp } from '@easypic/ncp-parser';
import type { Platform } from '../src/platform';
import { fromParsedPictureControl } from '../src/params';
import { canvasRenderer, type ImageRenderer } from '../src/renderer';
import {
  serializeFilterParams,
  type WorkerInboundMessage,
  type WorkerProgress,
  type WorkerResponse,
} from '../src/worker-protocol';
import { createWorkerServer } from '../src/worker-server';
import { nodeDecode, nodeEncode } from './helpers/node-platform';

const here = dirname(fileURLToPath(import.meta.url));
const astia = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')))),
);

const nodePlatform: Platform = {
  decode: (bytes) => nodeDecode(bytes),
  encode: (rgba, width, height, params) => nodeEncode(rgba, width, height, params.type, params.quality),
};

async function makePng(width: number, height: number): Promise<Uint8Array> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      rgba[index] = (x * 41) % 256;
      rgba[index + 1] = (y * 67) % 256;
      rgba[index + 2] = 120;
      rgba[index + 3] = 255;
    }
  }
  return nodeEncode(rgba, width, height, 'image/png', 0.92);
}

function success(messages: WorkerInboundMessage[], id: number): Extract<WorkerResponse, { ok: true }> {
  const message = messages.find((item): item is WorkerResponse => 'ok' in item && item.id === id);
  expect(message).toBeDefined();
  expect(message?.ok).toBe(true);
  return message as Extract<WorkerResponse, { ok: true }>;
}

describe('worker server', () => {
  let messages: WorkerInboundMessage[];
  let transfers: Transferable[][];

  beforeEach(() => {
    messages = [];
    transfers = [];
  });

  it('keeps loaded pixels behind a handle through preview, export, and disposal', async () => {
    const server = createWorkerServer({
      platform: nodePlatform,
      renderer: canvasRenderer,
      post(message, transfer = []) {
        messages.push(message);
        transfers.push(transfer);
      },
    });

    await server.handle({ id: 1, method: 'load', bytes: await makePng(12, 8) });
    const loaded = success(messages, 1).result;
    expect(loaded).toMatchObject({ id: 'image-1', width: 12, height: 8, orientation: 1, sourceFormat: 'image/png' });
    if (!loaded || !('id' in loaded)) throw new Error('Expected loaded image metadata');

    await server.handle({
      id: 2,
      method: 'preview',
      imageId: loaded.id,
      params: serializeFilterParams(astia),
      intensity: 0.5,
      maxLongEdge: 6,
    });
    const preview = success(messages, 2).result;
    expect(preview).toMatchObject({ width: 6, height: 4 });

    await server.handle({
      id: 3,
      method: 'export',
      imageId: loaded.id,
      params: serializeFilterParams(astia),
      options: { type: 'image/png', intensity: 1 },
    });
    const exported = success(messages, 3).result;
    expect(exported).toBeInstanceOf(Uint8Array);
    const decoded = await nodeDecode(exported as Uint8Array);
    expect([decoded.width, decoded.height]).toEqual([12, 8]);
    expect(transfers.some((items) => items.length === 1)).toBe(true);

    await server.handle({ id: 4, method: 'dispose-image', imageId: loaded.id });
    expect(success(messages, 4).result).toBeNull();
    await server.handle({
      id: 5,
      method: 'thumbnail',
      imageId: loaded.id,
      params: serializeFilterParams(astia),
      size: 4,
    });
    const missing = messages.find((item): item is WorkerResponse => 'ok' in item && item.id === 5);
    expect(missing).toEqual({
      id: 5,
      ok: false,
      error: { name: 'Error', message: 'Unknown image handle: image-1' },
    });
  });

  it('emits monotonic request progress using only documented stages', async () => {
    const server = createWorkerServer({
      platform: nodePlatform,
      renderer: canvasRenderer,
      post(message) {
        messages.push(message);
      },
    });
    await server.handle({ id: 10, method: 'load', bytes: await makePng(10, 6) });
    const loaded = success(messages, 10).result;
    if (!loaded || !('id' in loaded)) throw new Error('Expected loaded image metadata');
    await server.handle({
      id: 11,
      method: 'preview',
      imageId: loaded.id,
      params: serializeFilterParams(astia),
      intensity: 1,
      maxLongEdge: 5,
    });

    for (const id of [10, 11]) {
      const progress = messages.filter(
        (item): item is WorkerProgress => 'event' in item && item.event === 'progress' && 'id' in item && item.id === id,
      );
      const values = progress.map((item) => item.value);
      expect(values[0]).toBe(0);
      expect(values.at(-1)).toBe(1);
      expect(values).toEqual([...values].sort((a, b) => a - b));
      expect(progress.every((item) => ['decode', 'scale', 'render', 'encode'].includes(item.stage))).toBe(true);
    }
  });

  it('serializes thrown errors without leaking stacks and disposes its renderer', async () => {
    let disposeCount = 0;
    const failing: ImageRenderer = {
      kind: 'canvas',
      render() {
        throw new TypeError('render exploded');
      },
      dispose() {
        disposeCount++;
      },
    };
    const server = createWorkerServer({
      platform: nodePlatform,
      renderer: failing,
      post(message) {
        messages.push(message);
      },
    });
    await server.handle({ id: 20, method: 'load', bytes: await makePng(2, 2) });
    const loaded = success(messages, 20).result;
    if (!loaded || !('id' in loaded)) throw new Error('Expected loaded image metadata');
    await server.handle({
      id: 21,
      method: 'preview',
      imageId: loaded.id,
      params: serializeFilterParams(astia),
      intensity: 1,
      maxLongEdge: 2,
    });

    const failure = messages.find((item): item is WorkerResponse => 'ok' in item && item.id === 21);
    expect(failure).toEqual({
      id: 21,
      ok: false,
      error: { name: 'TypeError', message: 'render exploded' },
    });
    expect(failure && !failure.ok && 'stack' in failure.error).toBe(false);
    server.dispose();
    server.dispose();
    expect(disposeCount).toBe(1);
  });
});
