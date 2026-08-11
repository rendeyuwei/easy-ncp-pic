import { browserPlatform } from '../../src/platform';
import { canvasRenderer } from '../../src/renderer';
import type { WorkerInboundMessage, WorkerRequest } from '../../src/worker-protocol';
import { createWorkerServer } from '../../src/worker-server';

interface CanvasWorkerScope {
  postMessage(message: WorkerInboundMessage, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<WorkerRequest>) => void): void;
}

const scope = globalThis as unknown as CanvasWorkerScope;
const server = createWorkerServer({
  platform: browserPlatform,
  renderer: canvasRenderer,
  post(message, transfer = []) {
    scope.postMessage(message, transfer);
  },
});

scope.addEventListener('message', (event) => {
  void server.handle(event.data);
});
