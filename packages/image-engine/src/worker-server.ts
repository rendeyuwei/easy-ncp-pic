import { createEngine, type LoadedImage } from './engine';
import type { Platform } from './platform';
import type { ImageRenderer } from './renderer';
import {
  deserializeFilterParams,
  type ProgressStage,
  type WorkerProgress,
  type WorkerRequest,
  type WorkerResponse,
} from './worker-protocol';

export interface WorkerServerOptions {
  platform: Platform;
  renderer: ImageRenderer;
  post(message: WorkerResponse | WorkerProgress, transfer?: Transferable[]): void;
}

export interface WorkerServer {
  handle(request: WorkerRequest): Promise<void>;
  dispose(): void;
}

export function createWorkerServer(options: WorkerServerOptions): WorkerServer {
  const engine = createEngine(options.platform, options.renderer);
  const images = new Map<string, LoadedImage>();
  let nextImageId = 1;
  let disposed = false;

  function progress(id: number, stage: ProgressStage, value: number): void {
    options.post({ id, event: 'progress', stage, value });
  }

  function imageFor(id: string): LoadedImage {
    const image = images.get(id);
    if (!image) throw new Error(`Unknown image handle: ${id}`);
    return image;
  }

  async function handle(request: WorkerRequest): Promise<void> {
    try {
      if (disposed) throw new Error('Worker server is disposed');
      switch (request.method) {
        case 'load': {
          progress(request.id, 'decode', 0);
          const image = await engine.load(request.bytes);
          const id = `image-${nextImageId++}`;
          images.set(id, image);
          progress(request.id, 'decode', 1);
          options.post({
            id: request.id,
            ok: true,
            result: {
              id,
              width: image.width,
              height: image.height,
              orientation: image.orientation,
              sourceFormat: image.sourceFormat,
            },
          });
          return;
        }
        case 'preview': {
          progress(request.id, 'scale', 0);
          const image = imageFor(request.imageId);
          progress(request.id, 'scale', 0.4);
          progress(request.id, 'render', 0.4);
          const result = engine.renderPreview(
            image,
            deserializeFilterParams(request.params),
            request.intensity,
            request.maxLongEdge,
          );
          progress(request.id, 'render', 1);
          options.post(
            { id: request.id, ok: true, result },
            [result.data.buffer as ArrayBuffer],
          );
          return;
        }
        case 'thumbnail': {
          progress(request.id, 'scale', 0);
          const image = imageFor(request.imageId);
          progress(request.id, 'scale', 0.4);
          progress(request.id, 'render', 0.4);
          const result = engine.renderThumbnail(image, deserializeFilterParams(request.params), request.size);
          progress(request.id, 'render', 1);
          options.post(
            { id: request.id, ok: true, result },
            [result.data.buffer as ArrayBuffer],
          );
          return;
        }
        case 'export': {
          progress(request.id, 'render', 0);
          const image = imageFor(request.imageId);
          progress(request.id, 'render', 0.7);
          progress(request.id, 'encode', 0.7);
          const result = await engine.exportImage(
            image,
            deserializeFilterParams(request.params),
            request.options,
          );
          progress(request.id, 'encode', 1);
          options.post(
            { id: request.id, ok: true, result },
            [result.buffer as ArrayBuffer],
          );
          return;
        }
        case 'dispose-image': {
          images.delete(request.imageId);
          options.post({ id: request.id, ok: true, result: null });
          return;
        }
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      options.post({
        id: request.id,
        ok: false,
        error: { name: normalized.name, message: normalized.message },
      });
    }
  }

  return {
    handle,
    dispose() {
      if (disposed) return;
      disposed = true;
      images.clear();
      options.renderer.dispose?.();
    },
  };
}
