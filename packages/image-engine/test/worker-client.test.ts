import { describe, expect, it } from 'vitest';
import { CurveLut } from '../src/curve';
import type { FilterParams } from '../src/params';
import { createWorkerEngine, type WorkerLike } from '../src/worker-client';
import type { WorkerInboundMessage, WorkerLoadedImage, WorkerRequest } from '../src/worker-protocol';

const params: FilterParams = {
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

class FakeWorker implements WorkerLike {
  readonly posted: Array<{ message: WorkerRequest; transfer: Transferable[] }> = [];
  terminateCount = 0;
  private readonly listeners = new Set<(event: MessageEvent<WorkerInboundMessage>) => void>();
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>();

  postMessage(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.posted.push({ message, transfer });
  }

  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerInboundMessage>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<WorkerInboundMessage>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') this.listeners.add(listener as (event: MessageEvent<WorkerInboundMessage>) => void);
    else this.errorListeners.add(listener as (event: ErrorEvent) => void);
  }

  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerInboundMessage>) => void): void;
  removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  removeEventListener(
    type: 'message' | 'error',
    listener: ((event: MessageEvent<WorkerInboundMessage>) => void) | ((event: ErrorEvent) => void),
  ): void {
    if (type === 'message') this.listeners.delete(listener as (event: MessageEvent<WorkerInboundMessage>) => void);
    else this.errorListeners.delete(listener as (event: ErrorEvent) => void);
  }

  terminate(): void {
    this.terminateCount++;
  }

  emit(message: WorkerInboundMessage): void {
    const event = { data: message } as MessageEvent<WorkerInboundMessage>;
    for (const listener of this.listeners) listener(event);
  }

  emitError(message: string): void {
    const event = { message, preventDefault() {} } as ErrorEvent;
    for (const listener of this.errorListeners) listener(event);
  }
}

function loaded(id: string): WorkerLoadedImage {
  return { id, width: 4, height: 3, orientation: 1, sourceFormat: 'image/png' };
}

describe('worker engine client', () => {
  it('matches out-of-order responses to concurrent request IDs', async () => {
    const worker = new FakeWorker();
    const engine = createWorkerEngine(worker);
    const firstBytes = new Uint8Array([1, 2, 3]);
    const secondBytes = new Uint8Array([4, 5, 6]);

    const first = engine.load(firstBytes);
    const second = engine.load(secondBytes);
    worker.emit({ id: 2, ok: true, result: loaded('image-2') });
    worker.emit({ id: 1, ok: true, result: loaded('image-1') });

    await expect(first).resolves.toEqual(loaded('image-1'));
    await expect(second).resolves.toEqual(loaded('image-2'));
    expect(worker.posted[0].message).toMatchObject({ id: 1, method: 'load' });
    expect(worker.posted[1].message).toMatchObject({ id: 2, method: 'load' });
  });

  it('clones caller bytes, transfers the clone, and serializes preview parameters', async () => {
    const worker = new FakeWorker();
    const engine = createWorkerEngine(worker);
    const source = new Uint8Array([9, 8, 7]);

    const loading = engine.load(source);
    const loadRequest = worker.posted[0];
    if (loadRequest.message.method !== 'load') throw new Error('Expected load request');
    expect(loadRequest.message.bytes).not.toBe(source);
    expect(Array.from(loadRequest.message.bytes)).toEqual([9, 8, 7]);
    expect(loadRequest.transfer).toEqual([loadRequest.message.bytes.buffer]);
    worker.emit({ id: 1, ok: true, result: loaded('image-1') });
    const image = await loading;

    const previewing = engine.renderPreview(image, params, 0.5, 2);
    const previewRequest = worker.posted[1].message;
    if (previewRequest.method !== 'preview') throw new Error('Expected preview request');
    expect(previewRequest.params.curve).toBeInstanceOf(Float32Array);
    expect(previewRequest.params.curve).not.toBeInstanceOf(CurveLut);
    worker.emit({
      id: 2,
      ok: true,
      result: { width: 2, height: 2, data: new Float32Array(16) },
    });
    await expect(previewing).resolves.toMatchObject({ width: 2, height: 2 });
  });

  it('routes progress and fallback events and reconstructs remote errors', async () => {
    const worker = new FakeWorker();
    const fallbackMessages: string[] = [];
    const progress: Array<{ stage: string; value: number }> = [];
    const engine = createWorkerEngine(worker, { onFallback: (message) => fallbackMessages.push(message) });

    const request = engine.load(new Uint8Array([1]), { onProgress: (item) => progress.push(item) });
    worker.emit({ id: 1, event: 'progress', stage: 'decode', value: 0 });
    worker.emit({ event: 'fallback', message: 'WebGL2 is unavailable' });
    worker.emit({ id: 1, ok: false, error: { name: 'TypeError', message: 'bad image' } });

    await expect(request).rejects.toMatchObject({ name: 'TypeError', message: 'bad image' });
    expect(progress).toEqual([{ stage: 'decode', value: 0 }]);
    expect(fallbackMessages).toEqual(['WebGL2 is unavailable']);
  });

  it('sends image disposal and rejects pending work when disposed', async () => {
    const worker = new FakeWorker();
    const engine = createWorkerEngine(worker);

    const disposing = engine.disposeImage(loaded('image-9'));
    expect(worker.posted[0].message).toEqual({ id: 1, method: 'dispose-image', imageId: 'image-9' });
    worker.emit({ id: 1, ok: true, result: null });
    await expect(disposing).resolves.toBeUndefined();

    const pending = engine.load(new Uint8Array([1, 2]));
    engine.dispose();
    engine.dispose();
    await expect(pending).rejects.toThrow('Worker engine is disposed');
    expect(worker.terminateCount).toBe(1);
  });

  it('rejects pending work with the native Worker error instead of hanging', async () => {
    const worker = new FakeWorker();
    const engine = createWorkerEngine(worker);
    const pending = engine.load(new Uint8Array([1, 2, 3]));

    worker.emitError('worker runtime crashed');
    engine.dispose();

    await expect(pending).rejects.toThrow('worker runtime crashed');
  });
});
