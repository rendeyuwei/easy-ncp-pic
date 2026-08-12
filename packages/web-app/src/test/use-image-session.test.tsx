import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PixelBuffer, WorkerEngine, WorkerLoadedImage } from '@easypic/image-engine';
import { useImageSession, type ImageEngineFactory } from '../hooks/use-image-session';
import { parsePublicFilters } from '../lib/filters';
import { publicFiltersFixture } from './fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const loaded: WorkerLoadedImage = { id: 'image-1', width: 4, height: 2, orientation: 1, sourceFormat: 'image/png' };
const original: PixelBuffer = { width: 2, height: 1, data: new Float32Array([0, 0, 0, 1, 1, 1, 1, 1]) };
const newer: PixelBuffer = { width: 2, height: 1, data: new Float32Array([1, 0, 0, 1, 1, 0, 0, 1]) };
const older: PixelBuffer = { width: 2, height: 1, data: new Float32Array([0, 0, 1, 1, 0, 0, 1, 1]) };

function fakeEngine(overrides: Partial<WorkerEngine> = {}): WorkerEngine {
  return {
    load: vi.fn().mockResolvedValue(loaded),
    renderPreview: vi.fn().mockResolvedValue(original),
    renderThumbnail: vi.fn().mockResolvedValue(original),
    exportImage: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    disposeImage: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('useImageSession', () => {
  it('loads local bytes, creates an original preview, and disposes resources', async () => {
    const engine = fakeEngine();
    const factory: ImageEngineFactory = vi.fn(() => engine);
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result, unmount } = renderHook(() => useImageSession(filters, factory));
    const file = new File([new Uint8Array([1, 2, 3])], 'portrait.png', { type: 'image/png' });

    await act(() => result.current.load(file));

    expect(engine.load).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), expect.any(Object));
    expect(result.current.image).toEqual(loaded);
    expect(result.current.fileName).toBe('portrait.png');
    expect(result.current.originalPreview).toEqual(original);
    expect(result.current.filteredPreview).toEqual(original);
    unmount();
    expect(engine.disposeImage).toHaveBeenCalledWith(loaded);
    expect(engine.dispose).toHaveBeenCalledTimes(1);
  });

  it('never lets an older filter render replace the latest selection', async () => {
    const first = deferred<PixelBuffer>();
    const second = deferred<PixelBuffer>();
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    let oldRequest!: Promise<void>;
    let newRequest!: Promise<void>;
    act(() => { oldRequest = result.current.selectFilter(filters[0]); });
    act(() => { newRequest = result.current.selectFilter(filters[1]); });
    await act(async () => { second.resolve(newer); await newRequest; });
    await act(async () => { first.resolve(older); await oldRequest; });

    expect(result.current.selectedFilter?.id).toBe('filter-2');
    expect(result.current.filteredPreview).toEqual(newer);
  });

  it('clamps intensity and preserves editor state when export rejects', async () => {
    const engine = fakeEngine({ exportImage: vi.fn().mockRejectedValue(new Error('out of memory')) });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));
    await act(() => result.current.selectFilter(filters[0]));
    act(() => result.current.setIntensity(2));
    await waitFor(() => expect(result.current.intensity).toBe(1));

    await act(async () => {
      await expect(result.current.exportImage({ type: 'image/png', quality: 0.92 })).rejects.toThrow('out of memory');
    });
    expect(result.current.image).toEqual(loaded);
    expect(result.current.selectedFilter?.id).toBe(filters[0].id);
    expect(result.current.error).toContain('导出失败');
  });
});
