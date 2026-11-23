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
import { useLang } from '../locale-context';
import { AppError, codeForEngineMessage, type AppErrorCode } from '../lib/app-error';
import { toFilterParams, type PublicFilter } from '../lib/filters';
import { messages, type Messages } from '../lib/messages';

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
  loading: boolean;
  previewing: boolean;
  exporting: boolean;
  error: string | null;
  fallbackNotice: string | null;
  load(file: File): Promise<void>;
  selectFilter(filter: PublicFilter): Promise<void>;
  requestThumbnails(filters: ReadonlyArray<PublicFilter>): void;
  setIntensity(value: number): void;
  exportImage(options: ExportOptions): Promise<Uint8Array>;
  reset(): Promise<void>;
}

interface PreviewRequest {
  readonly filter: PublicFilter;
  readonly intensity: number;
  readonly token: number;
  resolve(): void;
}

interface FilterSelection {
  readonly filter: PublicFilter | null;
  readonly intensity: number;
}

type OperationName = 'load' | 'preview' | 'export' | 'validation';

interface OperationStatus {
  readonly active: boolean;
  readonly token: number;
  readonly sequence: number;
  readonly progress: number;
  readonly stage: string | null;
  readonly error: AppErrorCode | null;
}

type OperationStatuses = Record<OperationName, OperationStatus>;

const idleOperation: OperationStatus = {
  active: false,
  token: 0,
  sequence: 0,
  progress: 0,
  stage: null,
  error: null,
};

function idleOperations(): OperationStatuses {
  return {
    load: idleOperation,
    preview: idleOperation,
    export: idleOperation,
    validation: idleOperation,
  };
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

function failureCode(error: unknown, phase: 'load' | 'render' | 'export'): AppErrorCode {
  if (error instanceof AppError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return codeForEngineMessage(message, phase);
}

export function useImageSession(
  filters: ReadonlyArray<PublicFilter>,
  engineFactory: ImageEngineFactory = createBrowserWorkerEngine,
): ImageSessionState {
  const lang = useLang();
  const copyRef = useRef(messages[lang]);
  copyRef.current = messages[lang];
  const [fallbackCode, setFallbackCode] = useState<AppErrorCode | null>(null);
  const engineRef = useRef<WorkerEngine | null>(null);
  const engineFactoryRef = useRef(engineFactory);
  const getEngine = useCallback((): WorkerEngine => {
    if (!engineRef.current) engineRef.current = engineFactoryRef.current({
      onFallback: () => setFallbackCode('webgl-fallback'),
    });
    return engineRef.current;
  }, []);
  const imageRef = useRef<WorkerLoadedImage | null>(null);
  const committedSelectionRef = useRef<FilterSelection>({ filter: null, intensity: 1 });
  const requestedSelectionRef = useRef<FilterSelection>({ filter: null, intensity: 1 });
  const loadToken = useRef(0);
  const activeLoadToken = useRef<number | null>(null);
  const renderToken = useRef(0);
  const exportToken = useRef(0);
  const activeExportToken = useRef<number | null>(null);
  const physicalExportInFlight = useRef(false);
  const previewRunning = useRef(false);
  const runningPreview = useRef<PreviewRequest | null>(null);
  const queuedPreview = useRef<PreviewRequest | null>(null);
  const thumbnailGeneration = useRef(0);
  const thumbnailQueue = useRef<PublicFilter[]>([]);
  const thumbnailQueuedIds = useRef(new Set<string>());
  const thumbnailRunning = useRef(false);
  const thumbnailImageId = useRef<string | null>(null);
  const latestThumbnailFilters = useRef<ReadonlyArray<PublicFilter>>([]);

  const [image, setImage] = useState<WorkerLoadedImage | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedFilter, setSelectedFilter] = useState<PublicFilter | null>(null);
  const [pendingFilter, setPendingFilter] = useState<PublicFilter | null>(null);
  const [intensity, setIntensityState] = useState(1);
  const [originalPreview, setOriginalPreview] = useState<PixelBuffer | null>(null);
  const [filteredPreview, setFilteredPreview] = useState<PixelBuffer | null>(null);
  const [thumbnails, setThumbnails] = useState<ReadonlyMap<string, PixelBuffer>>(new Map());
  const [thumbnailLoading, setThumbnailLoading] = useState<ReadonlySet<string>>(new Set());
  const [operations, setOperations] = useState<OperationStatuses>(idleOperations);
  const operationSequence = useRef(0);

  const beginOperation = useCallback((name: OperationName, token: number): void => {
    const sequence = ++operationSequence.current;
    setOperations((current) => ({
      ...current,
      [name]: { active: true, token, sequence, progress: 0, stage: null, error: null },
    }));
  }, []);

  const updateOperationProgress = useCallback((
    name: OperationName,
    token: number,
    { stage, value }: { stage: string; value: number },
  ): void => {
    setOperations((current) => {
      const operation = current[name];
      if (!operation.active || operation.token !== token) return current;
      return {
        ...current,
        [name]: {
          ...operation,
          stage,
          progress: Math.max(operation.progress, value),
        },
      };
    });
  }, []);

  const finishOperation = useCallback((
    name: OperationName,
    token: number,
    updates: Partial<Pick<OperationStatus, 'progress' | 'stage' | 'error'>> = {},
  ): void => {
    const sequence = ++operationSequence.current;
    setOperations((current) => {
      const operation = current[name];
      if (operation.token !== token) return current;
      return {
        ...current,
        [name]: { ...operation, ...updates, active: false, sequence },
      };
    });
  }, []);

  const setValidationError = useCallback((code: AppErrorCode | null): void => {
    const sequence = ++operationSequence.current;
    setOperations((current) => ({
      ...current,
      validation: { ...idleOperation, sequence, error: code },
    }));
  }, []);

  const runPreviewLoop = useCallback(async (): Promise<void> => {
    if (previewRunning.current) return;
    previewRunning.current = true;
    try {
      while (queuedPreview.current) {
        const request = queuedPreview.current;
        queuedPreview.current = null;
        runningPreview.current = request;
        const activeImage = imageRef.current;
        if (!activeImage || request.token !== renderToken.current) {
          request.resolve();
          continue;
        }

        let preview: PixelBuffer | null = null;
        let renderError: unknown = null;
        try {
          preview = await getEngine().renderPreview(
            activeImage,
            toFilterParams(request.filter),
            request.intensity,
            previewLongEdge(),
            { onProgress: (event) => {
              if (request.token === renderToken.current) {
                updateOperationProgress('preview', request.token, event);
              }
            } },
          );
        } catch (error) {
          renderError = error;
        }

        if (runningPreview.current === request) runningPreview.current = null;
        if (
          request.token !== renderToken.current
          || imageRef.current?.id !== activeImage.id
          || queuedPreview.current
        ) {
          request.resolve();
          continue;
        }

        if (preview) {
          setFilteredPreview(preview);
          const committed = { filter: request.filter, intensity: request.intensity };
          committedSelectionRef.current = committed;
          requestedSelectionRef.current = committed;
          setSelectedFilter(request.filter);
          setIntensityState(request.intensity);
        } else {
          requestedSelectionRef.current = committedSelectionRef.current;
          setSelectedFilter(committedSelectionRef.current.filter);
          setIntensityState(committedSelectionRef.current.intensity);
        }
        setPendingFilter(null);
        finishOperation('preview', request.token, {
          error: preview ? null : failureCode(renderError, 'render'),
        });
        request.resolve();
      }
    } finally {
      runningPreview.current = null;
      previewRunning.current = false;
    }
  }, [finishOperation, getEngine, updateOperationProgress]);

  const queuePreview = useCallback((filter: PublicFilter, nextIntensity: number): Promise<void> => {
    if (!imageRef.current || activeLoadToken.current !== null) return Promise.resolve();
    requestedSelectionRef.current = { filter, intensity: nextIntensity };
    const token = ++renderToken.current;
    setPendingFilter(filter);
    beginOperation('preview', token);
    return new Promise<void>((resolve) => {
      runningPreview.current?.resolve();
      queuedPreview.current?.resolve();
      queuedPreview.current = { filter, intensity: nextIntensity, token, resolve };
      void runPreviewLoop();
    });
  }, [beginOperation, runPreviewLoop]);

  const invalidatePreviews = useCallback((updateState: boolean = true): void => {
    const token = renderToken.current;
    renderToken.current++;
    runningPreview.current?.resolve();
    queuedPreview.current?.resolve();
    queuedPreview.current = null;
    requestedSelectionRef.current = committedSelectionRef.current;
    if (updateState && token > 0) finishOperation('preview', token, { error: null });
  }, [finishOperation]);

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

  const enqueueThumbnails = useCallback((requestedFilters: ReadonlyArray<PublicFilter>): void => {
    const activeImage = imageRef.current;
    if (!activeImage || thumbnailImageId.current !== activeImage.id) return;
    const replacedIds = thumbnailQueue.current.map((filter) => filter.id);
    thumbnailQueue.current = [];
    for (const id of replacedIds) thumbnailQueuedIds.current.delete(id);
    const addedIds: string[] = [];
    for (const filter of requestedFilters) {
      if (thumbnailQueuedIds.current.has(filter.id)) continue;
      thumbnailQueuedIds.current.add(filter.id);
      thumbnailQueue.current.push(filter);
      addedIds.push(filter.id);
    }
    if (replacedIds.length === 0 && addedIds.length === 0) return;
    setThumbnailLoading((current) => {
      const next = new Set(current);
      for (const id of replacedIds) next.delete(id);
      for (const id of addedIds) next.add(id);
      return next;
    });
    if (addedIds.length > 0) void pumpThumbnails();
  }, [pumpThumbnails]);

  const reset = useCallback(async (): Promise<void> => {
    loadToken.current++;
    activeLoadToken.current = null;
    exportToken.current++;
    activeExportToken.current = null;
    invalidatePreviews();
    thumbnailGeneration.current++;
    thumbnailQueue.current = [];
    thumbnailQueuedIds.current.clear();
    thumbnailImageId.current = null;
    latestThumbnailFilters.current = [];
    const active = imageRef.current;
    imageRef.current = null;
    committedSelectionRef.current = { filter: null, intensity: 1 };
    requestedSelectionRef.current = committedSelectionRef.current;
    setImage(null);
    setFileName('');
    setSelectedFilter(null);
    setPendingFilter(null);
    setIntensityState(1);
    setOriginalPreview(null);
    setFilteredPreview(null);
    setThumbnails(new Map());
    setThumbnailLoading(new Set());
    setOperations(idleOperations());
    if (active) await getEngine().disposeImage(active);
  }, [getEngine, invalidatePreviews]);

  const load = useCallback(async (file: File): Promise<void> => {
    if (!accepts(file)) {
      setValidationError('file-type');
      return;
    }
    setValidationError(null);
    const token = ++loadToken.current;
    activeLoadToken.current = token;
    invalidatePreviews();
    beginOperation('load', token);
    thumbnailGeneration.current++;
    thumbnailQueue.current = [];
    thumbnailQueuedIds.current.clear();
    thumbnailImageId.current = null;
    setPendingFilter(null);
    setIntensityState(committedSelectionRef.current.intensity);
    setThumbnails(new Map());
    setThumbnailLoading(new Set());
    let loaded: WorkerLoadedImage | null = null;
    let committed = false;
    let engine: WorkerEngine | null = null;
    let loadErrorCode: AppErrorCode | null = null;
    try {
      engine = getEngine();
      const bytes = await readFileBytes(file);
      if (token !== loadToken.current) return;
      loaded = await engine.load(bytes, { onProgress: (event) => {
        if (token === loadToken.current) updateOperationProgress('load', token, event);
      } });
      if (token !== loadToken.current) return;
      const preview = await engine.renderPreview(loaded, identityParams(), 1, previewLongEdge(), {
        onProgress: (event) => {
          if (token === loadToken.current) updateOperationProgress('load', token, event);
        },
      });
      if (token !== loadToken.current) return;
      const previous = imageRef.current;
      imageRef.current = loaded;
      thumbnailImageId.current = loaded.id;
      committed = true;
      setImage(loaded);
      setFileName(file.name);
      setSelectedFilter(null);
      setPendingFilter(null);
      setIntensityState(1);
      committedSelectionRef.current = { filter: null, intensity: 1 };
      requestedSelectionRef.current = committedSelectionRef.current;
      setOriginalPreview(preview);
      setFilteredPreview(preview);
      updateOperationProgress('load', token, { stage: 'render', value: 1 });
      enqueueThumbnails(latestThumbnailFilters.current);
      if (previous && previous.id !== loaded.id) await engine.disposeImage(previous);
    } catch (loadError) {
      if (token === loadToken.current) {
        thumbnailImageId.current = imageRef.current?.id ?? null;
        enqueueThumbnails(latestThumbnailFilters.current);
        loadErrorCode = failureCode(loadError, 'load');
      }
    } finally {
      if (loaded && !committed && engine) await engine.disposeImage(loaded).catch(() => undefined);
      if (token === loadToken.current) {
        activeLoadToken.current = null;
        finishOperation('load', token, {
          error: loadErrorCode,
          ...(committed ? { progress: 1 } : {}),
        });
      }
    }
  }, [
    beginOperation,
    enqueueThumbnails,
    finishOperation,
    getEngine,
    invalidatePreviews,
    setValidationError,
    updateOperationProgress,
  ]);

  const selectFilter = useCallback((filter: PublicFilter): Promise<void> => (
    queuePreview(filter, requestedSelectionRef.current.intensity)
  ), [queuePreview]);

  const requestThumbnails = useCallback((requestedFilters: ReadonlyArray<PublicFilter>): void => {
    latestThumbnailFilters.current = [...requestedFilters];
    enqueueThumbnails(requestedFilters);
  }, [enqueueThumbnails, image]);

  const setIntensity = useCallback((value: number): void => {
    if (activeLoadToken.current !== null || activeExportToken.current !== null) return;
    const next = Math.min(1, Math.max(0, value));
    requestedSelectionRef.current = { ...requestedSelectionRef.current, intensity: next };
    setIntensityState(next);
    const filter = requestedSelectionRef.current.filter;
    if (filter) void queuePreview(filter, next);
  }, [queuePreview]);

  const exportImage = useCallback(async (options: ExportOptions): Promise<Uint8Array> => {
    if (physicalExportInFlight.current) {
      throw new AppError('export-in-progress', copyRef.current.errors['export-in-progress']);
    }
    const activeImage = imageRef.current;
    const selection = committedSelectionRef.current;
    const filter = selection.filter;
    if (!activeImage || !filter) throw new AppError('export-no-filter', copyRef.current.errors['export-no-filter']);
    const engine = getEngine();
    const token = ++exportToken.current;
    physicalExportInFlight.current = true;
    activeExportToken.current = token;
    beginOperation('export', token);
    let exportErrorCode: AppErrorCode | null = null;
    try {
      return await engine.exportImage(
        activeImage,
        toFilterParams(filter),
        { ...options, intensity: selection.intensity },
        { onProgress: (event) => {
          if (token === exportToken.current) updateOperationProgress('export', token, event);
        } },
      );
    } catch (exportError) {
      exportErrorCode = failureCode(exportError, 'export');
      throw exportError;
    } finally {
      physicalExportInFlight.current = false;
      if (token === exportToken.current) {
        activeExportToken.current = null;
        finishOperation('export', token, { error: exportErrorCode });
      }
    }
  }, [beginOperation, finishOperation, getEngine, updateOperationProgress]);

  useEffect(() => () => {
    loadToken.current++;
    activeLoadToken.current = null;
    exportToken.current++;
    activeExportToken.current = null;
    invalidatePreviews(false);
    thumbnailGeneration.current++;
    thumbnailQueue.current = [];
    thumbnailQueuedIds.current.clear();
    thumbnailImageId.current = null;
    latestThumbnailFilters.current = [];
    const active = imageRef.current;
    const engine = engineRef.current;
    imageRef.current = null;
    engineRef.current = null;
    if (active && engine) void engine.disposeImage(active);
    engine?.dispose();
  }, [invalidatePreviews]);

  const loading = operations.load.active;
  const previewing = operations.preview.active;
  const exporting = operations.export.active;
  const busy = loading || previewing || exporting;
  const activeFeedback = exporting
    ? operations.export
    : loading
      ? operations.load
      : previewing
        ? operations.preview
        : Object.values(operations).reduce((latest, operation) => (
          operation.sequence > latest.sequence ? operation : latest
        ), idleOperation);
  const latestError = Object.values(operations).reduce<OperationStatus | null>((latest, operation) => {
    if (!operation.error) return latest;
    return !latest || operation.sequence > latest.sequence ? operation : latest;
  }, null);

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
    progress: activeFeedback.progress,
    progressStage: activeFeedback.stage,
    busy,
    loading,
    previewing,
    exporting,
    error: latestError?.error ? messages[lang].errors[latestError.error] : null,
    fallbackNotice: fallbackCode ? messages[lang].errors[fallbackCode] : null,
    load,
    selectFilter,
    requestThumbnails,
    setIntensity,
    exportImage,
    reset,
  };
}
