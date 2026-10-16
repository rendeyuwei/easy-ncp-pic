import { createHash } from 'node:crypto';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';
import { server } from './server';

// Vitest's jsdom global uses Node webcrypto, which rejects ArrayBuffers created
// in the jsdom realm. Hash with createHash so bulk-import tests can digest fixtures.
Object.defineProperty(globalThis, 'crypto', {
  value: {
    subtle: {
      async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
        const name = (typeof algorithm === 'string' ? algorithm : algorithm.name).toLowerCase().replaceAll('-', '');
        const view = ArrayBuffer.isView(data)
          ? data
          : new Uint8Array(data);
        const bytes = Buffer.alloc(view.byteLength);
        const source = view as Uint8Array;
        for (let index = 0; index < view.byteLength; index += 1) bytes[index] = source[index] ?? 0;
        const output = createHash(name).update(bytes).digest();
        return output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
      },
    },
  },
  configurable: true,
});

if (typeof PointerEvent === 'undefined') {
  globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
}

if (typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

window.scrollTo = vi.fn();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  cleanup();
  vi.restoreAllMocks();
});

afterAll(() => {
  server.close();
});
