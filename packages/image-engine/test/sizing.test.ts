import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREVIEW_LONG_EDGE,
  LOW_MEMORY_PREVIEW_LONG_EDGE,
  computePreviewSize,
  assertWithinPixelLimits,
  orientationSwapsDimensions,
} from '../src/sizing';

describe('computePreviewSize', () => {
  it('defaults to a 2048 long edge', () => {
    expect(DEFAULT_PREVIEW_LONG_EDGE).toBe(2048);
    expect(LOW_MEMORY_PREVIEW_LONG_EDGE).toBe(1280);
  });

  it('scales down a large landscape image preserving aspect', () => {
    const s = computePreviewSize(4096, 2048);
    expect(s.width).toBe(2048);
    expect(s.height).toBe(1024);
  });

  it('scales down a large portrait image preserving aspect', () => {
    const s = computePreviewSize(3000, 6000, 2048);
    expect(s.height).toBe(2048);
    expect(s.width).toBe(1024);
  });

  it('does not upscale a small image', () => {
    const s = computePreviewSize(800, 600);
    expect(s.width).toBe(800);
    expect(s.height).toBe(600);
  });

  it('low-memory cap is smaller', () => {
    const s = computePreviewSize(4000, 2000, LOW_MEMORY_PREVIEW_LONG_EDGE);
    expect(s.width).toBe(1280);
  });
});

describe('assertWithinPixelLimits', () => {
  it('accepts a normal image', () => {
    expect(() => assertWithinPixelLimits(6000, 4000)).not.toThrow();
  });

  it('rejects a side over 10000px', () => {
    expect(() => assertWithinPixelLimits(10001, 100)).toThrow(/10000|side|dimension/i);
  });

  it('rejects over 80 megapixels total', () => {
    expect(() => assertWithinPixelLimits(9000, 9000)).toThrow(/pixels|total|large/i);
  });
});

describe('orientation', () => {
  it('orientations 5-8 swap dimensions; 1-4 do not', () => {
    for (const o of [1, 2, 3, 4]) expect(orientationSwapsDimensions(o)).toBe(false);
    for (const o of [5, 6, 7, 8]) expect(orientationSwapsDimensions(o)).toBe(true);
  });
});
