import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

if (typeof ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    readonly data: Uint8ClampedArray;
    readonly width: number;
    readonly height: number;

    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  } as typeof ImageData;
}

if (typeof PointerEvent === 'undefined') {
  globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
}

if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:test';
}

if (typeof URL.revokeObjectURL === 'undefined') {
  URL.revokeObjectURL = () => undefined;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
