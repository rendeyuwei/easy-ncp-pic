import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CurveLut,
  createBrowserWorkerEngine,
  type ExportOptions,
  type FilterParams,
  type PixelBuffer,
  type WorkerEngine,
  type WorkerEngineOptions,
  type WorkerLoadedImage,
} from '@easypic/image-engine';
import { toFilterParams, type PublicFilter } from '../lib/filters';

export type ImageEngineFactory = (options: WorkerEngineOptions) => WorkerEngine;

export interface ImageSessionState {
  image: WorkerLoadedImage | null;
  fileName: string;
  selectedFilter: PublicFilter | null;
  pendingFilter: PublicFilter | null;
  intensity: number;
  originalPreview: PixelBuffer | null;
  filteredPreview: PixelBuffer | null;
  thumbnails: ReadonlyMap<string, PixelBuffer>;
  thumbnailLoading: ReadonlySet<string>;
  progress: number;
  progressStage: string | null;
  busy: boolean;
  error: string | null;
  fallbackNotice: string | null;
  load(file: File): Promise<void>;
  selectFilter(filter: PublicFilter): Promise<void>;
  requestThumbnails(filters: ReadonlyArray<PublicFilter>): void;
  setIntensity(value: number): void;
  exportImage(options: ExportOptions): Promise<Uint8Array>;
  reset(): Promise<void>;
}

function identityParams(): FilterParams {
  return {
    schemaVersion: 1,
    baseMode: 'color',
    curveEnabled: false,
    curve: CurveLut.identity(),
    saturation: 0,
    hue: 0,
    sharpening: 0,
    monoFilter: null,
    toning: null,
  };
}

function previewLongEdge(): number {
  return typeof navigator !== 'undefined' && navigator.deviceMemory !== undefined && navigator.deviceMemory < 4
    ? 1280
    : 2048;
}

function accepts(file: File): boolean {
  if (file.type === 'image/jpeg' || file.type === 'image/png') return true;
  return /\.(?:jpe?g|png)$/i.test(file.name);
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file'));
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(file);
  });
}

function userError(error: unknown, phase: 'load' | 'render' | 'export'): string {
  const message = error instanceof Error ? error.message : String(error);
  if (phase === 'export') return `导出失败。编辑状态已保留，请重试。${message ? ` (${message})` : ''}`;
  if (/80,?000,?000|total/i.test(message)) return '照片尺寸过大，请选择不超过 8000 万总像素的照片。';
  if (/10000|side|dimension/i.test(message)) return '照片尺寸过大，请选择边长不超过 10000 像素的照片。';
  if (/worker/i.test(message)) return '图片处理线程启动失败，请刷新页面后重试。';
  if (phase === 'render') return '滤镜预览失败，请选择其他滤镜或重试。';
  return '无法读取这张照片，请确认文件是有效的 JPG 或 PNG。';
}

export function useImageSession(
  filters: ReadonlyArray<PublicFilter>,
  engineFactory: ImageEngineFactory = createBrowserWorkerEngine,
): ImageSessionState {
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const engineRef = useRef<WorkerEngine | null>(null);
  const engineFactoryRef = useRef(engineFactory);
  const getEngine = useCallback((): WorkerEngine => {
    if (!engineRef.current) engineRef.current = engineFactoryRef.current({
      onFallback: () => setFallbackNotice('WebGL 不可用，已切换到兼容模式，处理速度可能较慢。'),
    });
    return engineRef.current;
  }, []);
  const imageRef = useRef<WorkerLoadedImage | null>(null);
  const selectedRef = useRef<PublicFilter | null>(null);
  const intensityRef = useRef(1);
  const renderedFilterRef = useRef<PublicFilter | null>(null);
  const renderedIntensityRef = useRef(1);
  const loadToken = useRef(0);
  const renderToken = useRef(0);
  const thumbnailGeneration = useRef(0);
  const thumbnailQueue = useRef<PublicFilter[]>([]);
  const thumbnailQueuedIds = useRef(new Set<string>());
  const thumbnailRunning = useRef(false);
  const thumbnailImageId = useRef<string | null>(null);

  const [image, setImage] = useState<WorkerLoadedImage | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<PublicFilter | null>(null);
  const [pendingFilter, setPendingFilter] = useState<PublicFilter | null>(null);
  const [intensity, setIntensityState] = useState(1);
  const [originalPreview, setOriginalPreview] = useState<PixelBuffer | null>(null);
  const [filteredPreview, setFilteredPreview] = useState<PixelBuffer | null>(null);
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, PixelBuffer>>(new Map());
  const [thumbnailLoading, setThumbnailLoading] = useState<ReadonlySet<string>>(new Set());
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateProgress = useCallback(({ stage, value }: { stage: string; value: number }) => {
    setProgressStage(stage);
    setProgress((current) => Math.max(current, value));
  }, []);

  const renderSelected = useCallback(async (filter: PublicFilter, nextIntensity: number): Promise<void> => {
    const activeImage = imageRef.current;
    if (!activeImage) return;
    const engine = getEngine();
    const token = ++renderToken.current;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const preview = await engine.renderPreview(
        activeImage,
        toFilterParams(filter),
        nextIntensity,
        previewLongEdge(),
        { onProgress: (event) => {
          if (token === renderToken.current) updateProgress(event);
        } },
      );
      if (token === renderToken.current) {
        setFilteredPreview(preview);
        renderedFilterRef.current = filter;
        renderedIntensityRef.current = nextIntensity;
        selectedRef.current = filter;
        setSelectedFilter(filter);
        setPendingFilter(null);
        intensityRef.current = nextIntensity;
        setIntensityState(nextIntensity);
      }
    } catch (renderError) {
      if (token === renderToken.current) {
        selectedRef.current = renderedFilterRef.current;
        setSelectedFilter(renderedFilterRef.current);
        intensityRef.current = renderedIntensityRef.current;
        setIntensityState(renderedIntensityRef.current);
        setPendingFilter(null);
        setError(userError(renderError, 'render'));
      }
    } finally {
      if (token === renderToken.current) setBusy(false);
    }
  }, [getEngine, updateProgress]);

  const pumpThumbnails = useCallback(async (): Promise<void> => {
    if (thumbnailRunning.current) return;
    thumbnailRunning.current = true;
    try {
      while (true) {
        const filter = thumbnailQueue.current.shift();
        const activeImage = imageRef.current;
        if (!filter || !activeImage) return;
        const generation = thumbnailGeneration.current;
        let cached = false;
        try {
          const pixels = await getEngine().renderThumbnail(activeImage, toFilterParams(filter), 96);
          if (
            generation === thumbnailGeneration.current
            && imageRef.current?.id === activeImage.id
            && thumbnailImageId.current === activeImage.id
          ) {
            cached = true;
            setThumbnails((current) => {
              const next = new Map(current);
              next.set(filter.id, pixels);
              return next;
            });
          }
        } catch {
          // A failed thumbnail leaves the filter available for a later retry.
        } finally {
          if (generation === thumbnailGeneration.current) {
            if (!cached) thumbnailQueuedIds.current.delete(filter.id);
            setThumbnailLoading((current) => {
              if (!current.has(filter.id)) return current;
              const next = new Set(current);
              next.delete(filter.id);
              return next;
            });
          }
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    } finally {
      thumbnailRunning.current = false;
    }
  }, [getEngine]);

  const reset = useCallback(async (): Promise<void> => {
    loadToken.current++;
    renderToken.current++;
    thumbnailGeneration.current++;
    thumbnailQueue.current = [];
    thumbnailQueuedIds.current.clear();
    thumbnailImageId.current = null;
    const active = imageRef.current;
    imageRef.current = null;
    selectedRef.current = null;
    intensityRef.current = 1;
    renderedFilterRef.current = null;
    renderedIntensityRef.current = 1;
    setImage(null);
    setFileName('');
    setSelectedFilter(null);
    setPendingFilter(null);
    setIntensityState(1);
    setOriginalPreview(null);
    setFilteredPreview(null);
    setThumbnails(new Map());
    setThumbnailLoading(new Set());
    setProgress(0);
    setProgressStage(null);
    setBusy(false);
    setError(null);
    if (active) await getEngine().disposeImage(active);
  }, [getEngine]);

  const load = useCallback(async (file: File): Promise<void> => {
    if (!accepts(file)) {
      setError('请选择 JPG 或 PNG 照片。');
      return;
    }
    const token = ++loadToken.current;
    renderToken.current++;
    thumbnailGeneration.current++;
    thumbnailQueue.current = [];
    thumbnailQueuedIds.current.clear();
    thumbnailImageId.current = null;
    setPendingFilter(null);
    setThumbnails(new Map());
    setThumbnailLoading(new Set());
    setBusy(true);
    setError(null);
    setProgress(0);
    let loaded: WorkerLoadedImage | null = null;
    let committed = false;
    let engine: WorkerEngine | null = null;
    try {
      engine = getEngine();
      const bytes = await readFileBytes(file);
      if (token !== loadToken.current) return;
      loaded = await engine.load(bytes, { onProgress: (event) => {
        if (token === loadToken.current) updateProgress(event);
      } });
      if (token !== loadToken.current) return;
      const preview = await engine.renderPreview(loaded, identityParams(), 1, previewLongEdge(), {
        onProgress: (event) => {
          if (token === loadToken.current) updateProgress(event);
        },
      });
      if (token !== loadToken.current) return;
      const previous = imageRef.current;
      imageRef.current = loaded;
      thumbnailImageId.current = loaded.id;
      committed = true;
      setImage(loaded);
      setFileName(file.name);
      selectedRef.current = null;
      setSelectedFilter(null);
      setPendingFilter(null);
      intensityRef.current = 1;
      setIntensityState(1);
      renderedFilterRef.current = null;
      renderedIntensityRef.current = 1;
      setOriginalPreview(preview);
      setFilteredPreview(preview);
      setProgress(1);
      if (previous && previous.id !== loaded.id) await engine.disposeImage(previous);
    } catch (loadError) {
      if (token === loadToken.current) {
        thumbnailImageId.current = imageRef.current?.id ?? null;
        setError(userError(loadError, 'load'));
      }
    } finally {
      if (loaded && !committed && engine) await engine.disposeImage(loaded).catch(() => undefined);
      if (token === loadToken.current) setBusy(false);
    }
  }, [getEngine, updateProgress]);

  const selectFilter = useCallback(async (filter: PublicFilter): Promise<void> => {
    setPendingFilter(filter);
    await renderSelected(filter, intensityRef.current);
  }, [renderSelected]);

  const requestThumbnails = useCallback((requestedFilters: ReadonlyArray<PublicFilter>): void => {
    const activeImage = imageRef.current;
    if (!activeImage || thumbnailImageId.current !== activeImage.id) return;
    const addedIds: string[] = [];
    for (const filter of requestedFilters) {
      if (thumbnailQueuedIds.current.has(filter.id)) continue;
      thumbnailQueuedIds.current.add(filter.id);
      thumbnailQueue.current.push(filter);
      addedIds.push(filter.id);
    }
    if (addedIds.length === 0) return;
    setThumbnailLoading((current) => {
      const next = new Set(current);
      for (const id of addedIds) next.add(id);
      return next;
    });
    void pumpThumbnails();
  }, [image, pumpThumbnails]);

  const setIntensity = useCallback((value: number): void => {
    const next = Math.min(1, Math.max(0, value));
    intensityRef.current = next;
    setIntensityState(next);
    if (selectedRef.current) void renderSelected(selectedRef.current, next);
  }, [renderSelected]);

  const exportImage = useCallback(async (options: ExportOptions): Promise<Uint8Array> => {
    const activeImage = imageRef.current;
    const filter = selectedRef.current;
    if (!activeImage || !filter) throw new Error('请先选择一个滤镜。');
    const engine = getEngine();
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      return await engine.exportImage(
        activeImage,
        toFilterParams(filter),
        { ...options, intensity: intensityRef.current },
        { onProgress: updateProgress },
      );
    } catch (exportError) {
      setError(userError(exportError, 'export'));
      throw exportError;
    } finally {
      setBusy(false);
    }
  }, [getEngine, updateProgress]);

  useEffect(() => () => {
    loadToken.current++;
    renderToken.current++;
    thumbnailGeneration.current++;
    thumbnailQueue.current = [];
    thumbnailQueuedIds.current.clear();
    thumbnailImageId.current = null;
    const active = imageRef.current;
    const engine = engineRef.current;
    imageRef.current = null;
    engineRef.current = null;
    if (active && engine) void engine.disposeImage(active);
    engine?.dispose();
  }, []);

  return {
    image,
    fileName,
    selectedFilter,
    pendingFilter,
    intensity,
    originalPreview,
    filteredPreview,
    thumbnails,
    thumbnailLoading,
    progress,
    progressStage,
    busy,
    error,
    fallbackNotice,
    load,
    selectFilter,
    requestThumbnails,
    setIntensity,
    exportImage,
    reset,
  };
}
