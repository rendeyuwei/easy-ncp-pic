import { StrictMode, type PropsWithChildren } from 'react';
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
  it('defers Worker creation until after the StrictMode render probe', async () => {
    let disposed = false;
    const engine = fakeEngine({
      load: vi.fn(async () => {
        if (disposed) throw new Error('Worker engine is disposed');
        return loaded;
      }),
      dispose: vi.fn(() => { disposed = true; }),
    });
    const factory: ImageEngineFactory = vi.fn(() => engine);
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const wrapper = ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode>;
    const { result } = renderHook(() => useImageSession(filters, factory), { wrapper });

    expect(factory).not.toHaveBeenCalled();

    await act(() => result.current.load(
      new File([new Uint8Array([1, 2, 3])], 'strict.png', { type: 'image/png' }),
    ));

    expect(factory).toHaveBeenCalledOnce();
    expect(engine.load).toHaveBeenCalledOnce();
    expect(result.current.image).toEqual(loaded);
  });

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

  it('never lets an older image load replace the latest file', async () => {
    const first = deferred<WorkerLoadedImage>();
    const second = deferred<WorkerLoadedImage>();
    const firstImage = { ...loaded, id: 'first-image' };
    const secondImage = { ...loaded, id: 'second-image' };
    const engine = fakeEngine({
      load: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;

    act(() => {
      firstRequest = result.current.load(new File([new Uint8Array([1])], 'first.png', { type: 'image/png' }));
    });
    await waitFor(() => expect(engine.load).toHaveBeenCalledOnce());
    act(() => {
      secondRequest = result.current.load(new File([new Uint8Array([2])], 'second.png', { type: 'image/png' }));
    });
    await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2));
    await act(async () => { second.resolve(secondImage); await secondRequest; });
    await act(async () => { first.resolve(firstImage); await firstRequest; });

    expect(result.current.image).toEqual(secondImage);
    expect(result.current.fileName).toBe('second.png');
    expect(engine.disposeImage).toHaveBeenCalledWith(firstImage);
  });

  it('disposes an in-flight image without recreating the engine after unmount', async () => {
    const pending = deferred<WorkerLoadedImage>();
    const engine = fakeEngine({ load: vi.fn(() => pending.promise) });
    const factory: ImageEngineFactory = vi.fn(() => engine);
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result, unmount } = renderHook(() => useImageSession(filters, factory));
    let request!: Promise<void>;

    act(() => {
      request = result.current.load(new File([new Uint8Array([1])], 'pending.png', { type: 'image/png' }));
    });
    await waitFor(() => expect(engine.load).toHaveBeenCalledOnce());
    unmount();
    await act(async () => { pending.resolve(loaded); await request; });

    expect(engine.renderPreview).not.toHaveBeenCalled();
    expect(engine.disposeImage).toHaveBeenCalledWith(loaded);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('keeps the committed filter and preview when a new filter render fails', async () => {
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(newer)
        .mockRejectedValueOnce(new Error('render failed')),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));
    await act(() => result.current.selectFilter(filters[0]));

    await act(() => result.current.selectFilter(filters[1]));

    expect(result.current.selectedFilter?.id).toBe(filters[0].id);
    expect(result.current.filteredPreview).toEqual(newer);
    expect(result.current.error).toContain('滤镜预览失败');
  });

  it('rolls intensity back to the last rendered value when rendering fails', async () => {
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(newer)
        .mockRejectedValueOnce(new Error('render failed')),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));
    await act(() => result.current.selectFilter(filters[0]));

    act(() => result.current.setIntensity(0.5));
    await waitFor(() => expect(result.current.error).toContain('滤镜预览失败'));

    expect(result.current.intensity).toBe(1);
    expect(result.current.filteredPreview).toEqual(newer);
  });

  it('generates thumbnails when filters arrive after the photo loads', async () => {
    const engine = fakeEngine();
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result, rerender } = renderHook(
      ({ available }) => useImageSession(available, () => engine),
      { initialProps: { available: [] as typeof filters } },
    );
    await act(() => result.current.load(
      new File([new Uint8Array([1])], 'early.png', { type: 'image/png' }),
    ));
    expect(engine.renderThumbnail).not.toHaveBeenCalled();

    rerender({ available: filters });

    await waitFor(() => expect(result.current.thumbnails.has(filters[0].id)).toBe(true));
    expect(engine.renderThumbnail).toHaveBeenCalledOnce();
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
      await expect(result.current.exportImage({ type: 'image/jpeg', quality: 0.92 })).rejects.toThrow('out of memory');
    });
    expect(result.current.image).toEqual(loaded);
    expect(result.current.selectedFilter?.id).toBe(filters[0].id);
    expect(result.current.error).toBe('导出失败。编辑状态已保留，请重试。 (out of memory)');
  });

  it('distinguishes total-pixel and side-length limit errors', async () => {
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const totalEngine = fakeEngine({ load: vi.fn().mockRejectedValue(new Error('Image total 85500000 pixels exceeds the 80000000 pixel limit')) });
    const sideEngine = fakeEngine({ load: vi.fn().mockRejectedValue(new Error('Image dimension 10001px exceeds the 10000px side limit')) });
    const total = renderHook(() => useImageSession(filters, () => totalEngine));
    const side = renderHook(() => useImageSession(filters, () => sideEngine));

    await act(() => total.result.current.load(new File([new Uint8Array([1])], 'total.png', { type: 'image/png' })));
    await act(() => side.result.current.load(new File([new Uint8Array([1])], 'side.png', { type: 'image/png' })));

    expect(total.result.current.error).toContain('不超过 8000 万总像素');
    expect(side.result.current.error).toContain('边长不超过 10000 像素');
  });
});
