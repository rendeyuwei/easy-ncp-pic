import type { ExportOptions } from './engine';
import type { FilterParams } from './params';
import type { PixelBuffer } from './pixel';
import { DEFAULT_PREVIEW_LONG_EDGE } from './sizing';
import {
  serializeFilterParams,
  type ProgressStage,
  type WorkerInboundMessage,
  type WorkerLoadedImage,
  type WorkerRequest,
} from './worker-protocol';

export interface WorkerLike {
  postMessage(message: WorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerInboundMessage>) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent<WorkerInboundMessage>) => void): void;
  terminate(): void;
}

export interface WorkerEngineOptions {
  onFallback?: (message: string) => void;
}

export interface WorkerCallOptions {
  onProgress?: (progress: { stage: ProgressStage; value: number }) => void;
}

export interface WorkerEngine {
  load(bytes: Uint8Array, call?: WorkerCallOptions): Promise<WorkerLoadedImage>;
  renderPreview(
    image: WorkerLoadedImage,
    params: FilterParams,
    intensity?: number,
    maxLongEdge?: number,
    call?: WorkerCallOptions,
  ): Promise<PixelBuffer>;
  renderThumbnail(
    image: WorkerLoadedImage,
    params: FilterParams,
    size?: number,
    call?: WorkerCallOptions,
  ): Promise<PixelBuffer>;
  exportImage(
    image: WorkerLoadedImage,
    params: FilterParams,
    options?: ExportOptions,
    call?: WorkerCallOptions,
  ): Promise<Uint8Array>;
  disposeImage(image: WorkerLoadedImage): Promise<void>;
  dispose(): void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  validate(value: unknown): boolean;
  onProgress?: WorkerCallOptions['onProgress'];
}

function isLoadedImage(value: unknown): value is WorkerLoadedImage {
  if (!value || typeof value !== 'object') return false;
  const image = value as Partial<WorkerLoadedImage>;
  return (
    typeof image.id === 'string' &&
    typeof image.width === 'number' &&
    typeof image.height === 'number' &&
    typeof image.orientation === 'number' &&
    (image.sourceFormat === 'image/jpeg' || image.sourceFormat === 'image/png')
  );
}

function isPixelBuffer(value: unknown): value is PixelBuffer {
  if (!value || typeof value !== 'object') return false;
  const pixels = value as Partial<PixelBuffer>;
  return typeof pixels.width === 'number' && typeof pixels.height === 'number' && pixels.data instanceof Float32Array;
}

export function createWorkerEngine(worker: WorkerLike, options: WorkerEngineOptions = {}): WorkerEngine {
  const pending = new Map<number, PendingRequest>();
  let nextRequestId = 1;
  let disposed = false;

  const onMessage = (event: MessageEvent<WorkerInboundMessage>): void => {
    const message = event.data;
    if ('event' in message) {
      if (message.event === 'fallback') {
        options.onFallback?.(message.message);
        return;
      }
      pending.get(message.id)?.onProgress?.({ stage: message.stage, value: message.value });
      return;
    }

    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (!message.ok) {
      const error = new Error(message.error.message);
      error.name = message.error.name;
      request.reject(error);
      return;
    }
    if (!request.validate(message.result)) {
      request.reject(new Error(`Invalid worker response for request ${message.id}`));
      return;
    }
    request.resolve(message.result);
  };

  worker.addEventListener('message', onMessage);

  function send<T>(
    createRequest: (id: number) => WorkerRequest,
    validate: (value: unknown) => value is T,
    call?: WorkerCallOptions,
    transfer: Transferable[] = [],
  ): Promise<T> {
    if (disposed) return Promise.reject(new Error('Worker engine is disposed'));
    const id = nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve, reject, validate, onProgress: call?.onProgress });
      worker.postMessage(createRequest(id), transfer);
    });
  }

  return {
    load(bytes, call) {
      const owned = bytes.slice();
      return send(
        (id) => ({ id, method: 'load', bytes: owned }),
        isLoadedImage,
        call,
        [owned.buffer as ArrayBuffer],
      );
    },
    renderPreview(image, params, intensity = 1, maxLongEdge = DEFAULT_PREVIEW_LONG_EDGE, call) {
      return send(
        (id) => ({
          id,
          method: 'preview',
          imageId: image.id,
          params: serializeFilterParams(params),
          intensity,
          maxLongEdge,
        }),
        isPixelBuffer,
        call,
      );
    },
    renderThumbnail(image, params, size = 96, call) {
      return send(
        (id) => ({
          id,
          method: 'thumbnail',
          imageId: image.id,
          params: serializeFilterParams(params),
          size,
        }),
        isPixelBuffer,
        call,
      );
    },
    exportImage(image, params, exportOptions = {}, call) {
      return send(
        (id) => ({
          id,
          method: 'export',
          imageId: image.id,
          params: serializeFilterParams(params),
          options: exportOptions,
        }),
        (value): value is Uint8Array => value instanceof Uint8Array,
        call,
      );
    },
    async disposeImage(image) {
      await send(
        (id) => ({ id, method: 'dispose-image', imageId: image.id }),
        (value): value is null => value === null,
      );
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.removeEventListener('message', onMessage);
      for (const request of pending.values()) request.reject(new Error('Worker engine is disposed'));
      pending.clear();
      worker.terminate();
    },
  };
}

export function createBrowserWorkerEngine(options: WorkerEngineOptions = {}): WorkerEngine {
  if (typeof Worker === 'undefined') throw new Error('Web Workers are unavailable');
  const worker = new Worker(new URL('./worker-runtime.js', import.meta.url), {
    type: 'module',
    name: 'easypic-image-engine',
  });
  return createWorkerEngine(worker as unknown as WorkerLike, options);
}
