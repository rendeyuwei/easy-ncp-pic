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
  if (phase === 'export') return `导出失败。编辑状态已保留，请重试或改用 JPG。${message ? ` (${message})` : ''}`;
  if (/10000|80,?000,?000|pixel|dimension/i.test(message)) return '照片尺寸过大，请选择边长不超过 10000 像素的照片。';
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
  const renderToken = useRef(0);

  const [image, setImage] = useState<WorkerLoadedImage | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<PublicFilter | null>(null);
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
        { onProgress: updateProgress },
      );
      if (token === renderToken.current) setFilteredPreview(preview);
    } catch (renderError) {
      if (token === renderToken.current) setError(userError(renderError, 'render'));
    } finally {
      if (token === renderToken.current) setBusy(false);
    }
  }, [getEngine, updateProgress]);

  const generateThumbnails = useCallback(async (activeImage: WorkerLoadedImage): Promise<void> => {
    const engine = getEngine();
    const ids = new Set(filters.map((filter) => filter.id));
    setThumbnailLoading(ids);
    const results = await Promise.allSettled(
      filters.map(async (filter) => ({
        id: filter.id,
        pixels: await engine.renderThumbnail(activeImage, toFilterParams(filter), 96),
      })),
    );
    if (imageRef.current?.id !== activeImage.id) return;
    const next = new Map<string, PixelBuffer>();
    for (const result of results) if (result.status === 'fulfilled') next.set(result.value.id, result.value.pixels);
    setThumbnails(next);
    setThumbnailLoading(new Set());
  }, [filters, getEngine]);

  useEffect(() => {
    const active = imageRef.current;
    if (active && filters.length > 0) void generateThumbnails(active);
  }, [filters, generateThumbnails]);

  const reset = useCallback(async (): Promise<void> => {
    renderToken.current++;
    const active = imageRef.current;
    imageRef.current = null;
    selectedRef.current = null;
    intensityRef.current = 1;
    setImage(null);
    setFileName('');
    setSelectedFilter(null);
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
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const engine = getEngine();
      const previous = imageRef.current;
      if (previous) await engine.disposeImage(previous);
      renderToken.current++;
      const bytes = await readFileBytes(file);
      const loaded = await engine.load(bytes, { onProgress: updateProgress });
      const preview = await engine.renderPreview(loaded, identityParams(), 1, previewLongEdge(), {
        onProgress: updateProgress,
      });
      imageRef.current = loaded;
      setImage(loaded);
      setFileName(file.name);
      selectedRef.current = null;
      setSelectedFilter(null);
      intensityRef.current = 1;
      setIntensityState(1);
      setOriginalPreview(preview);
      setFilteredPreview(preview);
      setProgress(1);
      void generateThumbnails(loaded);
    } catch (loadError) {
      setError(userError(loadError, 'load'));
    } finally {
      setBusy(false);
    }
  }, [generateThumbnails, getEngine, updateProgress]);

  const selectFilter = useCallback(async (filter: PublicFilter): Promise<void> => {
    selectedRef.current = filter;
    setSelectedFilter(filter);
    await renderSelected(filter, intensityRef.current);
  }, [renderSelected]);

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
    setIntensity,
    exportImage,
    reset,
  };
}
