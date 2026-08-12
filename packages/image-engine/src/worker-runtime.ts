import { browserPlatform } from './platform';
import { createBrowserRenderer } from './render-webgl';
import type { WorkerFallback, WorkerInboundMessage, WorkerRequest } from './worker-protocol';
import { createWorkerServer } from './worker-server';

interface WorkerRuntimeScope {
  postMessage(message: WorkerInboundMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = globalThis as unknown as WorkerRuntimeScope;

const renderer = createBrowserRenderer({
  onFallback(error) {
    const message = error instanceof Error ? error.message : String(error);
    const event: WorkerFallback = { event: 'fallback', message };
    scope.postMessage(event);
  },
});

const server = createWorkerServer({
  platform: browserPlatform,
  renderer,
  post(message, transfer = []) {
    scope.postMessage(message, transfer);
  },
});

scope.addEventListener('message', (event) => {
  void server.handle(event.data);
});
