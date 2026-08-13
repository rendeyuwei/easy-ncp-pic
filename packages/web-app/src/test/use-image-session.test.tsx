import { StrictMode, type PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.useRealTimers());

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

  it('coalesces rapid filter selection to the running and latest requests', async () => {
    const first = deferred<PixelBuffer>();
    const second = deferred<PixelBuffer>();
    const third = deferred<PixelBuffer>();
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
        .mockImplementationOnce(() => third.promise),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        { ...publicFiltersFixture.categories[0].filters[0], parsed: {
          ...publicFiltersFixture.categories[0].filters[0].parsed,
          saturation: 0,
        } },
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second', parsed: {
          ...publicFiltersFixture.categories[0].filters[0].parsed,
          saturation: 1,
        } },
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-3', displayName: 'Third', parsed: {
          ...publicFiltersFixture.categories[0].filters[0].parsed,
          saturation: 2,
        } },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    let firstRequest!: Promise<void>;
    let replacedRequest!: Promise<void>;
    let latestRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.selectFilter(filters[0]);
      replacedRequest = result.current.selectFilter(filters[1]);
      latestRequest = result.current.selectFilter(filters[2]);
    });
    const callsWhileFirstRuns = vi.mocked(engine.renderPreview).mock.calls.length;
    let firstSettled = false;
    let replacedSettled = false;
    const firstSettlement = firstRequest.then(() => { firstSettled = true; });
    const replacedSettlement = replacedRequest.then(() => { replacedSettled = true; });
    await act(async () => { await Promise.resolve(); });
    const settledBeforeFirst = [firstSettled, replacedSettled];

    await act(async () => { first.resolve(older); await first.promise; });
    await act(async () => { await Promise.resolve(); });
    const selectedAfterFirst = result.current.selectedFilter;
    const previewAfterFirst = result.current.filteredPreview;
    const pendingAfterFirst = result.current.pendingFilter;

    await act(async () => {
      second.resolve(newer);
      third.resolve(newer);
      await Promise.all([
        firstRequest,
        replacedRequest,
        latestRequest,
        firstSettlement,
        replacedSettlement,
      ]);
    });

    expect(callsWhileFirstRuns).toBe(2);
    expect(settledBeforeFirst).toEqual([true, true]);
    expect(vi.mocked(engine.renderPreview).mock.calls.slice(1).map(([, params]) => params.saturation))
      .toEqual([0, 2]);
    expect(selectedAfterFirst).toBeNull();
    expect(previewAfterFirst).toEqual(original);
    expect(pendingAfterFirst?.id).toBe('filter-3');
    expect(result.current.selectedFilter?.id).toBe('filter-3');
    expect(result.current.filteredPreview).toEqual(newer);
    expect(result.current.pendingFilter).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('retains an intensity change while the first filter preview is pending', async () => {
    const first = deferred<PixelBuffer>();
    const latest = deferred<PixelBuffer>();
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => latest.promise),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    let request!: Promise<void>;
    act(() => {
      request = result.current.selectFilter(filters[0]);
      result.current.setIntensity(0.4);
    });
    const intensityWhilePending = result.current.intensity;
    const selectedWhilePending = result.current.selectedFilter;
    const previewWhilePending = result.current.filteredPreview;

    await act(async () => {
      first.resolve(older);
      await first.promise;
      await Promise.resolve();
    });
    const callsAfterFirst = vi.mocked(engine.renderPreview).mock.calls.length;
    const latestIntensity = vi.mocked(engine.renderPreview).mock.calls.at(-1)?.[2];
    await act(async () => {
      latest.resolve(newer);
      await latest.promise;
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
    await request;

    expect(intensityWhilePending).toBe(0.4);
    expect(selectedWhilePending).toBeNull();
    expect(previewWhilePending).toEqual(original);
    expect(callsAfterFirst).toBe(3);
    expect(latestIntensity).toBe(0.4);
    expect(result.current.selectedFilter?.id).toBe(filters[0].id);
    expect(result.current.filteredPreview).toEqual(newer);
    expect(result.current.intensity).toBe(0.4);
    expect(result.current.busy).toBe(false);
  });

  it('settles and ignores filter and intensity input during a replacement load', async () => {
    const replacementLoad = deferred<WorkerLoadedImage>();
    const replacement = { ...loaded, id: 'replacement-image' };
    const engine = fakeEngine({
      load: vi.fn()
        .mockResolvedValueOnce(loaded)
        .mockImplementationOnce(() => replacementLoad.promise),
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(newer)
        .mockResolvedValueOnce(older),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })));
    await act(() => result.current.selectFilter(filters[0]));

    let replacementRequest!: Promise<void>;
    act(() => {
      replacementRequest = result.current.load(
        new File([new Uint8Array([2])], 'replacement.png', { type: 'image/png' }),
      );
    });
    await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2));

    let selectionRequest!: Promise<void>;
    act(() => {
      selectionRequest = result.current.selectFilter(filters[1]);
      result.current.setIntensity(0.4);
    });
    let selectionSettled = false;
    const settlement = selectionRequest.then(() => { selectionSettled = true; });
    await act(async () => { await Promise.resolve(); });

    expect(selectionSettled).toBe(true);
    expect(engine.renderPreview).toHaveBeenCalledTimes(2);
    expect(result.current.selectedFilter?.id).toBe(filters[0].id);
    expect(result.current.filteredPreview).toEqual(newer);
    expect(result.current.intensity).toBe(1);
    expect(result.current.pendingFilter).toBeNull();
    expect(result.current.busy).toBe(true);

    await act(async () => {
      replacementLoad.resolve(replacement);
      await Promise.all([replacementRequest, selectionRequest, settlement]);
    });

    expect(engine.renderPreview).toHaveBeenCalledTimes(3);
    expect(engine.renderPreview).toHaveBeenLastCalledWith(
      replacement,
      expect.anything(),
      1,
      expect.any(Number),
      expect.any(Object),
    );
    expect(result.current.image).toEqual(replacement);
    expect(result.current.selectedFilter).toBeNull();
    expect(result.current.intensity).toBe(1);
    expect(result.current.busy).toBe(false);
  });

  it('rejects an invalid replacement without invalidating a pending first-filter preview', async () => {
    const pending = deferred<PixelBuffer>();
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(() => pending.promise),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    let previewRequest!: Promise<void>;
    act(() => { previewRequest = result.current.selectFilter(filters[0]); });
    let previewSettled = false;
    const settlement = previewRequest.then(() => { previewSettled = true; });

    await act(() => result.current.load(new File([new Uint8Array([2])], 'invalid.gif', { type: 'image/gif' })));
    await act(async () => { await Promise.resolve(); });

    expect(previewSettled).toBe(false);
    expect(engine.load).toHaveBeenCalledOnce();
    expect(engine.renderPreview).toHaveBeenCalledTimes(2);
    expect(result.current.pendingFilter?.id).toBe(filters[0].id);
    expect(result.current.previewing).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.busy).toBe(true);
    expect(result.current.selectedFilter).toBeNull();
    expect(result.current.filteredPreview).toEqual(original);
    expect(result.current.error).toBe('请选择 JPG 或 PNG 照片。');

    await act(async () => {
      pending.resolve(newer);
      await Promise.all([previewRequest, settlement]);
    });

    expect(result.current.selectedFilter?.id).toBe(filters[0].id);
    expect(result.current.filteredPreview).toEqual(newer);
    expect(result.current.pendingFilter).toBeNull();
    expect(result.current.previewing).toBe(false);
    expect(result.current.busy).toBe(false);
  });

  it('suppresses a stale preview rejection and progress after newer work is queued', async () => {
    const stale = deferred<PixelBuffer>();
    const latest = deferred<PixelBuffer>();
    let staleProgress!: (event: { stage: 'render'; value: number }) => void;
    let latestProgress!: (event: { stage: 'render'; value: number }) => void;
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce((...args: Parameters<WorkerEngine['renderPreview']>) => {
          staleProgress = args[4]?.onProgress as typeof staleProgress;
          return stale.promise;
        })
        .mockImplementationOnce((...args: Parameters<WorkerEngine['renderPreview']>) => {
          latestProgress = args[4]?.onProgress as typeof latestProgress;
          return latest.promise;
        }),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    let staleRequest!: Promise<void>;
    let latestRequest!: Promise<void>;
    act(() => {
      staleRequest = result.current.selectFilter(filters[0]);
      staleProgress({ stage: 'render', value: 0.3 });
      latestRequest = result.current.selectFilter(filters[1]);
    });
    expect(result.current.progress).toBe(0);

    await act(async () => {
      stale.reject(new Error('stale render failed'));
      await staleRequest;
      await Promise.resolve();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.pendingFilter?.id).toBe(filters[1].id);

    act(() => {
      latestProgress({ stage: 'render', value: 0.6 });
      staleProgress({ stage: 'render', value: 0.9 });
    });
    expect(result.current.progress).toBe(0.6);

    await act(async () => {
      latest.resolve(newer);
      await latestRequest;
    });
    expect(result.current.selectedFilter?.id).toBe(filters[1].id);
    expect(result.current.filteredPreview).toEqual(newer);
    expect(result.current.error).toBeNull();
  });

  it('clears a pending filter as soon as a replacement load supersedes its render', async () => {
    const pendingRender = deferred<PixelBuffer>();
    const replacementLoad = deferred<WorkerLoadedImage>();
    const replacement = { ...loaded, id: 'replacement-image' };
    const engine = fakeEngine({
      load: vi.fn()
        .mockResolvedValueOnce(loaded)
        .mockImplementationOnce(() => replacementLoad.promise),
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(() => pendingRender.promise)
        .mockResolvedValueOnce(newer),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })));

    let filterRequest!: Promise<void>;
    act(() => { filterRequest = result.current.selectFilter(filters[0]); });
    let filterSettled = false;
    const filterSettlement = filterRequest.then(() => { filterSettled = true; });
    expect(result.current.pendingFilter?.id).toBe(filters[0].id);

    let replacementRequest!: Promise<void>;
    act(() => { replacementRequest = result.current.load(new File([new Uint8Array([2])], 'replacement.png', { type: 'image/png' })); });
    await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.pendingFilter).toBeNull();
    expect(filterSettled).toBe(true);

    await act(async () => { replacementLoad.resolve(replacement); await replacementRequest; });
    await act(async () => {
      pendingRender.resolve(older);
      await Promise.all([filterRequest, filterSettlement]);
    });
  });

  it('clears a pending filter when its replacement load fails', async () => {
    const pendingRender = deferred<PixelBuffer>();
    const engine = fakeEngine({
      load: vi.fn()
        .mockResolvedValueOnce(loaded)
        .mockRejectedValueOnce(new Error('replacement load failed')),
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(() => pendingRender.promise),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })));

    let filterRequest!: Promise<void>;
    act(() => { filterRequest = result.current.selectFilter(filters[0]); });
    expect(result.current.pendingFilter?.id).toBe(filters[0].id);

    await act(() => result.current.load(new File([new Uint8Array([2])], 'replacement.png', { type: 'image/png' })));

    expect(result.current.pendingFilter).toBeNull();

    await act(async () => { pendingRender.resolve(older); await filterRequest; });
  });

  it('settles running and queued filter requests when reset invalidates previews', async () => {
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

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.selectFilter(filters[0]);
      secondRequest = result.current.selectFilter(filters[1]);
    });
    let firstSettled = false;
    let secondSettled = false;
    const settlements = [
      firstRequest.then(() => { firstSettled = true; }),
      secondRequest.then(() => { secondSettled = true; }),
    ];

    await act(() => result.current.reset());
    await act(async () => { await Promise.resolve(); });
    const settledBeforeRenders = [firstSettled, secondSettled];
    await act(async () => {
      first.resolve(older);
      second.resolve(newer);
      await Promise.all([firstRequest, secondRequest, ...settlements]);
    });

    expect(settledBeforeRenders).toEqual([true, true]);
    expect(result.current.image).toBeNull();
    expect(result.current.pendingFilter).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(engine.renderPreview).toHaveBeenCalledTimes(2);
  });

  it('settles running and queued filter requests when unmount invalidates previews', async () => {
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
    const { result, unmount } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    act(() => {
      firstRequest = result.current.selectFilter(filters[0]);
      secondRequest = result.current.selectFilter(filters[1]);
    });
    let firstSettled = false;
    let secondSettled = false;
    const settlements = [
      firstRequest.then(() => { firstSettled = true; }),
      secondRequest.then(() => { secondSettled = true; }),
    ];

    unmount();
    await act(async () => { await Promise.resolve(); });
    const settledBeforeRenders = [firstSettled, secondSettled];
    await act(async () => {
      first.resolve(older);
      second.resolve(newer);
      await Promise.all([firstRequest, secondRequest, ...settlements]);
    });

    expect(settledBeforeRenders).toEqual([true, true]);
    expect(engine.disposeImage).toHaveBeenCalledWith(loaded);
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(engine.renderPreview).toHaveBeenCalledTimes(2);
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
    expect(result.current.pendingFilter).toBeNull();
    expect(result.current.busy).toBe(false);
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

  it('renders requested thumbnails one at a time in FIFO order', async () => {
    const first = deferred<PixelBuffer>();
    const second = deferred<PixelBuffer>();
    const third = deferred<PixelBuffer>();
    const engine = fakeEngine({
      renderThumbnail: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise)
        .mockImplementationOnce(() => third.promise),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-3', displayName: 'Third' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    expect(engine.renderThumbnail).not.toHaveBeenCalled();
    act(() => result.current.requestThumbnails(filters));
    expect(engine.renderThumbnail).toHaveBeenCalledOnce();

    await act(async () => { first.resolve(original); await first.promise; });
    await waitFor(() => expect(engine.renderThumbnail).toHaveBeenCalledTimes(2));
    expect(engine.renderThumbnail).toHaveBeenNthCalledWith(2, loaded, expect.any(Object), 96);

    await act(async () => { second.resolve(newer); await second.promise; });
    await waitFor(() => expect(engine.renderThumbnail).toHaveBeenCalledTimes(3));
    await act(async () => { third.resolve(older); await third.promise; });
    await waitFor(() => expect(result.current.thumbnailLoading.size).toBe(0));

    expect([...result.current.thumbnails.keys()]).toEqual(filters.map((filter) => filter.id));
  });

  it('deduplicates a thumbnail ID queued behind another filter', async () => {
    const first = deferred<PixelBuffer>();
    const engine = fakeEngine({
      renderThumbnail: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce(newer),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    act(() => {
      result.current.requestThumbnails(filters);
      result.current.requestThumbnails([filters[1]]);
    });
    expect(engine.renderThumbnail).toHaveBeenCalledOnce();
    expect(result.current.thumbnailLoading).toEqual(new Set(filters.map((filter) => filter.id)));

    await act(async () => { first.resolve(original); await first.promise; });
    await waitFor(() => expect(result.current.thumbnails.get(filters[1].id)).toEqual(newer));

    expect(engine.renderThumbnail).toHaveBeenCalledTimes(2);
    expect([...result.current.thumbnails.keys()]).toEqual(filters.map((filter) => filter.id));
    act(() => result.current.requestThumbnails([filters[1]]));
    expect(engine.renderThumbnail).toHaveBeenCalledTimes(2);
  });

  it('discards stale thumbnails and replays visible work for a replacement photo', async () => {
    const pending = deferred<PixelBuffer>();
    const replacement = { ...loaded, id: 'replacement-image' };
    const engine = fakeEngine({
      load: vi.fn()
        .mockResolvedValueOnce(loaded)
        .mockResolvedValueOnce(replacement),
      renderThumbnail: vi.fn()
        .mockImplementationOnce(() => pending.promise)
        .mockResolvedValueOnce(newer),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })));
    act(() => result.current.requestThumbnails(filters));
    expect(engine.renderThumbnail).toHaveBeenCalledOnce();

    await act(() => result.current.load(
      new File([new Uint8Array([2])], 'replacement.png', { type: 'image/png' }),
    ));
    await act(async () => { pending.resolve(older); await pending.promise; });

    expect(result.current.image).toEqual(replacement);
    expect(result.current.thumbnails.size).toBe(0);
    expect(result.current.thumbnailLoading).toEqual(new Set(filters.map((filter) => filter.id)));
    expect(engine.renderThumbnail).toHaveBeenCalledOnce();

    await waitFor(() => expect(result.current.thumbnails.get(filters[0].id)).toEqual(newer));
    expect(engine.renderThumbnail).toHaveBeenLastCalledWith(replacement, expect.any(Object), 96);
  });

  it('does not cache old-photo thumbnails requested while a replacement load is pending', async () => {
    const replacementLoad = deferred<WorkerLoadedImage>();
    const replacement = { ...loaded, id: 'replacement-image' };
    const engine = fakeEngine({
      load: vi.fn()
        .mockResolvedValueOnce(loaded)
        .mockImplementationOnce(() => replacementLoad.promise),
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(newer),
      renderThumbnail: vi.fn(async (image) => image.id === loaded.id ? older : newer),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })));

    let replacementRequest!: Promise<void>;
    act(() => {
      replacementRequest = result.current.load(
        new File([new Uint8Array([2])], 'replacement.png', { type: 'image/png' }),
      );
    });
    await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2));
    act(() => result.current.requestThumbnails(filters));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.thumbnails.size).toBe(0);

    await act(async () => { replacementLoad.resolve(replacement); await replacementRequest; });
    await waitFor(() => expect(result.current.thumbnails.get(filters[0].id)).toEqual(newer));

    expect(engine.renderThumbnail).toHaveBeenCalledOnce();
    expect(engine.renderThumbnail).toHaveBeenCalledWith(replacement, expect.any(Object), 96);
  });

  it('retries a visible-category request automatically when replacement loading fails', async () => {
    const replacementLoad = deferred<WorkerLoadedImage>();
    const engine = fakeEngine({
      load: vi.fn()
        .mockResolvedValueOnce(loaded)
        .mockImplementationOnce(() => replacementLoad.promise),
      renderThumbnail: vi.fn().mockResolvedValue(newer),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })));

    let replacementRequest!: Promise<void>;
    act(() => {
      replacementRequest = result.current.load(
        new File([new Uint8Array([2])], 'replacement.png', { type: 'image/png' }),
      );
    });
    await waitFor(() => expect(engine.load).toHaveBeenCalledTimes(2));
    act(() => result.current.requestThumbnails(filters));
    expect(engine.renderThumbnail).not.toHaveBeenCalled();

    await act(async () => {
      replacementLoad.reject(new Error('replacement load failed'));
      await replacementRequest;
    });
    await waitFor(() => expect(result.current.thumbnails.get(filters[0].id)).toEqual(newer));

    expect(result.current.image).toEqual(loaded);
    expect(engine.renderThumbnail).toHaveBeenCalledOnce();
    expect(engine.renderThumbnail).toHaveBeenCalledWith(loaded, expect.any(Object), 96);
  });

  it('invalidates running and queued thumbnails when the session resets', async () => {
    const pending = deferred<PixelBuffer>();
    const engine = fakeEngine({ renderThumbnail: vi.fn(() => pending.promise) });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));
    vi.useFakeTimers();
    try {
      act(() => result.current.requestThumbnails(filters));

      await act(() => result.current.reset());
      await act(async () => { pending.resolve(older); await pending.promise; });
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });

      expect(result.current.image).toBeNull();
      expect(result.current.thumbnails.size).toBe(0);
      expect(result.current.thumbnailLoading.size).toBe(0);
      expect(engine.renderThumbnail).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not submit queued thumbnails after unmount invalidates the session', async () => {
    const pending = deferred<PixelBuffer>();
    const engine = fakeEngine({ renderThumbnail: vi.fn(() => pending.promise) });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result, unmount } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));
    vi.useFakeTimers();
    try {
      act(() => result.current.requestThumbnails(filters));

      unmount();
      await act(async () => { pending.resolve(older); await pending.promise; });
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });

      expect(engine.renderThumbnail).toHaveBeenCalledOnce();
      expect(engine.disposeImage).toHaveBeenCalledWith(loaded);
      expect(engine.dispose).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('allows an explicitly requested thumbnail to retry after rendering fails', async () => {
    const engine = fakeEngine({
      renderThumbnail: vi.fn()
        .mockRejectedValueOnce(new Error('thumbnail failed'))
        .mockResolvedValueOnce(newer),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));

    act(() => result.current.requestThumbnails(filters));
    await waitFor(() => expect(result.current.thumbnailLoading.size).toBe(0));
    expect(result.current.thumbnails.size).toBe(0);

    act(() => result.current.requestThumbnails(filters));
    await waitFor(() => expect(result.current.thumbnails.get(filters[0].id)).toEqual(newer));

    expect(engine.renderThumbnail).toHaveBeenCalledTimes(2);
  });

  it('lets a user preview enter the worker queue between thumbnail items', async () => {
    const firstThumbnail = deferred<PixelBuffer>();
    const secondThumbnail = deferred<PixelBuffer>();
    const preview = deferred<PixelBuffer>();
    const submissions: string[] = [];
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockImplementationOnce(() => {
          submissions.push('preview');
          return preview.promise;
        }),
      renderThumbnail: vi.fn()
        .mockImplementationOnce(() => {
          submissions.push('thumbnail-1');
          return firstThumbnail.promise;
        })
        .mockImplementationOnce(() => {
          submissions.push('thumbnail-2');
          return secondThumbnail.promise;
        }),
    });
    const filters = parsePublicFilters({
      categories: [{ ...publicFiltersFixture.categories[0], filters: [
        publicFiltersFixture.categories[0].filters[0],
        { ...publicFiltersFixture.categories[0].filters[0], id: 'filter-2', displayName: 'Second' },
      ] }],
    }).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));
    vi.useFakeTimers();
    try {
      act(() => result.current.requestThumbnails(filters));

      await act(async () => { firstThumbnail.resolve(original); await firstThumbnail.promise; });
      let previewRequest!: Promise<void>;
      act(() => { previewRequest = result.current.selectFilter(filters[1]); });

      expect(submissions).toEqual(['thumbnail-1', 'preview']);
      expect(result.current.pendingFilter?.id).toBe(filters[1].id);
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      expect(submissions).toEqual(['thumbnail-1', 'preview', 'thumbnail-2']);

      await act(async () => { preview.resolve(newer); await previewRequest; });
      await act(async () => { secondThumbnail.resolve(older); await secondThumbnail.promise; });
      await act(async () => { await vi.runOnlyPendingTimersAsync(); });
      expect(result.current.selectedFilter?.id).toBe(filters[1].id);
      expect(result.current.filteredPreview).toEqual(newer);
    } finally {
      vi.useRealTimers();
    }
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

  it.each(['preview-first', 'export-first'] as const)(
    'keeps busy and operation progress owned when %s completes',
    async (completionOrder) => {
      const preview = deferred<PixelBuffer>();
      const exported = deferred<Uint8Array>();
      let previewProgress!: (event: { stage: 'render'; value: number }) => void;
      let exportProgress!: (event: { stage: 'encode'; value: number }) => void;
      const bytes = new Uint8Array([9, 8, 7]);
      const engine = fakeEngine({
        renderPreview: vi.fn()
          .mockResolvedValueOnce(original)
          .mockResolvedValueOnce(newer)
          .mockImplementationOnce((...args: Parameters<WorkerEngine['renderPreview']>) => {
            previewProgress = args[4]?.onProgress as typeof previewProgress;
            return preview.promise;
          }),
        exportImage: vi.fn((...args: Parameters<WorkerEngine['exportImage']>) => {
          exportProgress = args[3]?.onProgress as typeof exportProgress;
          return exported.promise;
        }),
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

      let exportRequest!: Promise<Uint8Array>;
      let previewRequest!: Promise<void>;
      act(() => {
        exportRequest = result.current.exportImage({ type: 'image/png' });
        previewRequest = result.current.selectFilter(filters[1]);
        previewProgress({ stage: 'render', value: 0.2 });
        exportProgress({ stage: 'encode', value: 0.6 });
      });
      expect(result.current.busy).toBe(true);
      expect(result.current.progress).toBe(0.6);
      expect(result.current.progressStage).toBe('encode');

      if (completionOrder === 'preview-first') {
        await act(async () => { preview.resolve(older); await previewRequest; });
        expect(result.current.busy).toBe(true);
        expect(result.current.progress).toBe(0.6);
        await act(async () => { exported.resolve(bytes); await exportRequest; });
      } else {
        await act(async () => { exported.resolve(bytes); await exportRequest; });
        expect(result.current.busy).toBe(true);
        expect(result.current.progress).toBe(0.2);
        act(() => exportProgress({ stage: 'encode', value: 0.9 }));
        expect(result.current.progress).toBe(0.2);
        await act(async () => { preview.resolve(older); await previewRequest; });
      }

      expect(result.current.busy).toBe(false);
      expect(result.current.selectedFilter?.id).toBe(filters[1].id);
      expect(result.current.filteredPreview).toEqual(older);
      await expect(exportRequest).resolves.toEqual(bytes);
    },
  );

  it('does not let a later preview success clear an overlapping export error', async () => {
    const preview = deferred<PixelBuffer>();
    const exported = deferred<Uint8Array>();
    const engine = fakeEngine({
      renderPreview: vi.fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValueOnce(newer)
        .mockImplementationOnce(() => preview.promise),
      exportImage: vi.fn(() => exported.promise),
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

    let exportRequest!: Promise<Uint8Array>;
    let previewRequest!: Promise<void>;
    act(() => {
      exportRequest = result.current.exportImage({ type: 'image/png' });
      previewRequest = result.current.selectFilter(filters[1]);
    });
    const rejection = expect(exportRequest).rejects.toThrow('export failed');
    await act(async () => {
      exported.reject(new Error('export failed'));
      await rejection;
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBe('导出失败。编辑状态已保留，请重试。 (export failed)');

    await act(async () => {
      preview.resolve(older);
      await previewRequest;
    });

    expect(result.current.busy).toBe(false);
    expect(result.current.selectedFilter?.id).toBe(filters[1].id);
    expect(result.current.error).toBe('导出失败。编辑状态已保留，请重试。 (export failed)');
  });

  it('rejects a concurrent direct export without replacing the active export owner', async () => {
    const first = deferred<Uint8Array>();
    let firstProgress!: (event: { stage: 'encode'; value: number }) => void;
    const firstBytes = new Uint8Array([4, 5, 6]);
    const engine = fakeEngine({
      exportImage: vi.fn((...args: Parameters<WorkerEngine['exportImage']>) => {
        firstProgress = args[3]?.onProgress as typeof firstProgress;
        return first.promise;
      }),
    });
    const filters = parsePublicFilters(publicFiltersFixture).categories[0].filters;
    const { result } = renderHook(() => useImageSession(filters, () => engine));
    await act(() => result.current.load(new File([new Uint8Array([1])], 'p.png', { type: 'image/png' })));
    await act(() => result.current.selectFilter(filters[0]));

    let firstRequest!: Promise<Uint8Array>;
    act(() => { firstRequest = result.current.exportImage({ type: 'image/png' }); });
    act(() => firstProgress({ stage: 'encode', value: 0.4 }));

    let secondRequest!: Promise<Uint8Array>;
    act(() => { secondRequest = result.current.exportImage({ type: 'image/jpeg', quality: 0.8 }); });
    let secondRejected = false;
    const secondSettlement = secondRequest.catch((error: unknown) => {
      secondRejected = error instanceof Error && error.message === '已有导出任务正在进行。';
    });
    await act(async () => { await Promise.resolve(); });

    expect(secondRejected).toBe(true);
    expect(engine.exportImage).toHaveBeenCalledOnce();
    expect(result.current.exporting).toBe(true);
    expect(result.current.busy).toBe(true);
    expect(result.current.progress).toBe(0.4);
    expect(result.current.progressStage).toBe('encode');
    expect(result.current.error).toBeNull();

    act(() => firstProgress({ stage: 'encode', value: 0.8 }));
    expect(result.current.progress).toBe(0.8);
    await act(async () => {
      first.resolve(firstBytes);
      await Promise.all([firstRequest, secondSettlement]);
    });

    expect(result.current.exporting).toBe(false);
    expect(result.current.busy).toBe(false);
    await expect(firstRequest).resolves.toEqual(firstBytes);
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
