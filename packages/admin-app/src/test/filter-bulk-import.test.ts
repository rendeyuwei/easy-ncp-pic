import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BULK_FILTER_FILES,
  inspectBulkFilterFiles,
  runBulkFilterImport,
  toFilterCreateInput,
  type BulkFilterRow,
} from '../features/filters/filter-bulk-import';
import { createFilterCatalog } from '../features/filters/filter-catalog';
import { useBulkCreateFilters, useFilters } from '../features/filters/filter-queries';
import { queryKeys } from '../features/query-keys';
import { AdminApiClient, ApiFailure, type AdminApi, type FilterCreateInput } from '../lib/admin-client';
import type { AdminFilter } from '../lib/api-schema';
import { SessionProvider } from '../session/session-provider';
import { categoryFixture, filterFixture } from './fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const fixture02 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON02.NCP')),
);
const fixture33 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON33.NCP')),
);

function fixtureFile(bytes: Uint8Array<ArrayBuffer>, name: string): File {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.slice().buffer,
  });
  return file;
}

const defaults = {
  categoryId: 'film',
  isEnabled: true,
  startingSortOrder: 21,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => {
      resolve = next;
      reject = fail;
    }),
    resolve,
    reject,
  };
}

async function readyRows(count: number): Promise<BulkFilterRow[]> {
  const [base] = await inspectBulkFilterFiles([fixtureFile(fixture02, 'base.NCP')], defaults);
  if (!base) throw new Error('Expected a valid fixture row');
  return Array.from({ length: count }, (_, index) => ({
    ...base,
    id: `row-${index + 1}`,
    fileName: `row-${index + 1}.NCP`,
    displayName: `Filter ${index + 1}`,
    sortOrder: String(index + 1),
  }));
}

function createApi(
  createFilter: AdminApi['createFilter'],
  listFilters: AdminApi['listFilters'] = vi.fn(async () => []),
): AdminApi {
  return {
    setUnauthorizedHandler: vi.fn(),
    restoreSession: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    listCategories: vi.fn(async () => [categoryFixture]),
    createCategory: vi.fn(async () => categoryFixture),
    updateCategory: vi.fn(async () => categoryFixture),
    deleteCategory: vi.fn(async () => undefined),
    listFilters,
    createFilter,
    updateFilter: vi.fn(async () => filterFixture),
    deleteFilter: vi.fn(async () => undefined),
  };
}

function renderBulkCreateHook(api: AdminApi, queryClient: QueryClient) {
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SessionProvider, { api, queryClient }, children),
    );
  }

  return renderHook(() => useBulkCreateFilters(), { wrapper: Wrapper });
}

function renderFilterHooks(api: AdminApi, queryClient: QueryClient) {
  function Wrapper({ children }: PropsWithChildren) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SessionProvider, { api, queryClient }, children),
    );
  }

  return renderHook(() => ({ filters: useFilters(), bulk: useBulkCreateFilters() }), { wrapper: Wrapper });
}

function renderBulkCreateConsumer(api: AdminApi, queryClient: QueryClient) {
  let current: ReturnType<typeof useBulkCreateFilters> | null = null;

  function Consumer() {
    current = useBulkCreateFilters();
    return null;
  }

  function tree(showConsumer: boolean) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        SessionProvider,
        { api, queryClient },
        showConsumer ? createElement(Consumer) : null,
      ),
    );
  }

  const view = render(tree(true));
  return {
    current() {
      if (!current) throw new Error('Expected the bulk-create consumer to render');
      return current;
    },
    unmountConsumer() {
      view.rerender(tree(false));
    },
  };
}

describe('inspectBulkFilterFiles', () => {
  it('keeps input order and inherits the batch defaults for valid NCP fixtures', async () => {
    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'a.NCP'),
      fixtureFile(fixture33, 'b.NCP'),
    ], defaults);

    expect(rows.map((row) => [row.displayName, row.categoryId, row.sortOrder])).toEqual([
      ['Fuji Astia', 'film', '21'],
      ['SHING TokugawaTone2', 'film', '22'],
    ]);
    expect(rows.map((row) => row.isEnabled)).toEqual([true, true]);
    expect(rows.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(rows.map((row) => row.ncpSha256)).toEqual([
      'ed53222f4a2329c3f42a2dd6391b4b62d1214b1e3eac917d9bd11a8f22f9e43f',
      '5a3e2e9a768234f0fa653f1fc50eef3993118788737e57fe4bbd8d219fa8bc12',
    ]);
    expect(rows.map((row) => row.remedy)).toEqual(['none', 'none']);
    expect(rows.map((row) => row.categoryOverridden)).toEqual([false, false]);
    expect(rows.map((row) => row.enabledOverridden)).toEqual([false, false]);
  });

  it('keeps invalid files visible without upload bytes while preserving input order', async () => {
    const damaged = fixture02.slice();
    damaged[0] = 0;

    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'first.NCP'),
      fixtureFile(damaged, 'damaged.NCP'),
      fixtureFile(fixture33, 'last.NCP'),
    ], defaults);

    expect(rows.map((row) => [row.fileName, row.status, row.message])).toEqual([
      ['first.NCP', 'ready', null],
      ['damaged.NCP', 'invalid', 'NCP 文件已损坏或格式无效'],
      ['last.NCP', 'ready', null],
    ]);
    expect(rows[1]?.inspection).toBeNull();
    expect(rows[1]?.ncpBase64).toBeNull();
    expect(rows[1]?.ncpSha256).toBeNull();
    expect(rows[1]?.remedy).toBe('none');
  });

  it('marks only later byte-identical files as duplicates', async () => {
    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'one.NCP'),
      fixtureFile(fixture02, 'two.NCP'),
    ], defaults);

    expect(rows.map((row) => [row.fileName, row.status, row.ncpBase64 === null, row.remedy])).toEqual([
      ['one.NCP', 'ready', false, 'none'],
      ['two.NCP', 'duplicate', false, 'none'],
    ]);
  });

  it('assigns deterministic unique IDs that do not depend on duplicate file names', async () => {
    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'same.NCP'),
      fixtureFile(fixture33, 'same.NCP'),
    ], defaults);

    expect(rows.map((row) => row.id)).toEqual(['bulk-filter-0', 'bulk-filter-1']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('accepts exactly 100 files', async () => {
    const rows = await inspectBulkFilterFiles(
      Array.from({ length: MAX_BULK_FILTER_FILES }, (_, index) => fixtureFile(fixture02, `${index}.NCP`)),
      defaults,
    );

    expect(rows).toHaveLength(MAX_BULK_FILTER_FILES);
    expect(rows.at(-1)?.sortOrder).toBe('120');
  });

  it('rejects 101 files before reading any bytes', async () => {
    const arrayBuffer = vi.fn(async () => fixture02.slice().buffer);
    const guardedFile = { name: 'guarded.NCP', size: fixture02.length, arrayBuffer } as unknown as File;
    const files = Array.from({ length: MAX_BULK_FILTER_FILES + 1 }, () => guardedFile);

    await expect(inspectBulkFilterFiles(files, defaults)).rejects.toThrow('一次最多选择 100 个 NCP 文件');

    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe('runBulkFilterImport', () => {
  it('builds create input from the edited row values and preserves per-row overrides', async () => {
    const [base] = await readyRows(1);
    const row = {
      ...base!,
      ncpBase64: 'encoded-ncp',
      displayName: '  Edited Astia  ',
      categoryId: 'category-portrait',
      sortOrder: '47',
      isEnabled: false,
      categoryOverridden: true,
      enabledOverridden: true,
    };

    expect(toFilterCreateInput(row)).toEqual({
      ncpBase64: 'encoded-ncp',
      displayName: 'Edited Astia',
      categoryId: 'category-portrait',
      sortOrder: 47,
      isEnabled: false,
    });
  });

  it('awaits each create, records a duplicate, and continues with later rows', async () => {
    const rows = await readyRows(3);
    rows[1] = { ...rows[1]!, status: 'failed', remedy: 'retry' };
    const first = deferred<typeof filterFixture>();
    const second = deferred<typeof filterFixture>();
    const third = deferred<typeof filterFixture>();
    const create = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    const updates: Array<[string, string, string | null, string]> = [];

    const resultPromise = runBulkFilterImport(rows, create, (id, update) => {
      updates.push([id, update.status, update.message, update.remedy]);
    });

    expect(create).toHaveBeenCalledTimes(1);
    first.resolve(filterFixture);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create).toHaveBeenCalledTimes(2);
    second.reject(new ApiFailure(409, 'DUPLICATE_NCP', 'duplicate'));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    third.resolve(filterFixture);

    await expect(resultPromise).resolves.toEqual({ createdCount: 2, failedCount: 1, paused: false });
    expect(updates).toEqual([
      ['row-1', 'importing', null, 'none'],
      ['row-1', 'success', '已导入', 'none'],
      ['row-2', 'importing', null, 'none'],
      ['row-2', 'duplicate', '该 NCP 已经发布，请选择其他文件', 'none'],
      ['row-3', 'importing', null, 'none'],
      ['row-3', 'success', '已导入', 'none'],
    ]);
  });

  it('pauses on a status-0 failure and leaves later rows untouched', async () => {
    let rows = await readyRows(3);
    const create = vi.fn()
      .mockResolvedValueOnce(filterFixture)
      .mockRejectedValueOnce(new ApiFailure(0, 'NETWORK_ERROR', 'offline'));

    const result = await runBulkFilterImport(rows, create, (id, update) => {
      rows = rows.map((row) => row.id === id ? { ...row, ...update } : row);
    });

    expect(result).toEqual({ createdCount: 1, failedCount: 1, paused: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(rows.map((row) => [row.status, row.message, row.remedy])).toEqual([
      ['success', '已导入', 'none'],
      ['ambiguous', '网络响应中断，请刷新并核对后再继续', 'reconcile'],
      ['ready', null, 'none'],
    ]);
  });

  it('marks a status-0 outcome ambiguous and never blindly resubmits it', async () => {
    let rows = await readyRows(2);
    const firstCreate = vi.fn(async () => {
      throw new ApiFailure(0, 'NETWORK_ERROR', 'response lost');
    });

    const firstResult = await runBulkFilterImport(rows, firstCreate, (id, update) => {
      rows = rows.map((row) => row.id === id ? { ...row, ...update } : row);
    });

    expect(firstResult).toEqual({ createdCount: 0, failedCount: 1, paused: true });
    expect(rows[0]).toMatchObject({
      status: 'ambiguous',
      message: '网络响应中断，请刷新并核对后再继续',
      remedy: 'reconcile',
    });
    expect(rows[1]).toMatchObject({ status: 'ready' });

    const blindRetry = vi.fn(async (_input: FilterCreateInput) => filterFixture);
    await expect(runBulkFilterImport(rows, blindRetry, () => undefined)).resolves.toEqual({
      createdCount: 1,
      failedCount: 0,
      paused: false,
    });
    expect(blindRetry).toHaveBeenCalledTimes(1);
    expect(blindRetry.mock.calls[0]?.[0].displayName).toBe('Filter 2');
  });

  it.each([
    [new ApiFailure(409, 'SLUG_CONFLICT', 'conflict'), 'displayName'],
    [new ApiFailure(400, 'VALIDATION_ERROR', 'invalid', [{ field: 'displayName', message: 'name' }]), 'displayName'],
    [new ApiFailure(400, 'VALIDATION_ERROR', 'invalid', [{ field: 'categoryId', message: 'category' }]), 'categoryId'],
    [new ApiFailure(400, 'VALIDATION_ERROR', 'invalid', [{ field: 'sortOrder', message: 'order' }]), 'sortOrder'],
    [new ApiFailure(400, 'VALIDATION_ERROR', 'invalid', [
      { field: 'displayName', message: 'name' },
      { field: 'categoryId', message: 'category' },
    ]), 'none'],
    [new ApiFailure(413, 'PAYLOAD_TOO_LARGE', 'large'), 'none'],
    [new ApiFailure(422, 'INVALID_NCP', 'invalid'), 'none'],
    [new ApiFailure(422, 'UNSUPPORTED_NCP', 'unsupported'), 'none'],
    [new ApiFailure(429, 'RATE_LIMITED', 'slow down'), 'retry'],
    [new ApiFailure(503, 'NETWORK_ERROR', 'upstream unavailable'), 'retry'],
    [new ApiFailure(503, 'SERVICE_UNAVAILABLE', 'offline'), 'retry'],
  ])('maps %s to the typed %s remedy', async (failure, remedy) => {
    let rows = await readyRows(1);

    await runBulkFilterImport(rows, vi.fn(async () => {
      throw failure;
    }), (id, update) => {
      rows = rows.map((row) => row.id === id ? { ...row, ...update } : row);
    });

    expect(rows[0]).toMatchObject({ status: 'failed', remedy });
  });

  it('never resubmits successes and skips ineligible, client-invalid, or payload-less rows', async () => {
    const rows = await readyRows(7);
    rows[0] = { ...rows[0]!, status: 'success' };
    rows[1] = { ...rows[1]!, status: 'invalid' };
    rows[2] = { ...rows[2]!, status: 'duplicate' };
    rows[3] = { ...rows[3]!, displayName: ' ' };
    rows[4] = { ...rows[4]!, ncpBase64: null };
    rows[5] = { ...rows[5]!, status: 'failed', remedy: 'retry' };
    const create = vi.fn(async (_input: FilterCreateInput) => filterFixture);
    const updatedIds: string[] = [];

    const result = await runBulkFilterImport(rows, create, (id) => updatedIds.push(id));

    expect(result).toEqual({ createdCount: 2, failedCount: 0, paused: false });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([input]) => input.displayName)).toEqual(['Filter 6', 'Filter 7']);
    expect(updatedIds).toEqual(['row-6', 'row-6', 'row-7', 'row-7']);
  });

  it.each([
    [new ApiFailure(409, 'SLUG_CONFLICT', 'conflict'), '请修改显示名称，或使用单个新增流程自定义 Slug'],
    [new ApiFailure(400, 'VALIDATION_ERROR', 'invalid', [{ field: 'sortOrder', message: 'server order' }]), 'server order'],
    [new ApiFailure(413, 'PAYLOAD_TOO_LARGE', 'large'), '完整上传请求超过 64 KiB；当前支持的 NCP 文件应为 638 字节'],
    [new ApiFailure(422, 'INVALID_NCP', 'invalid'), '服务器判定该文件不是有效的受支持 NCP'],
    [new ApiFailure(422, 'UNSUPPORTED_NCP', 'unsupported'), '服务器判定当前不支持发布此 NCP'],
  ])('persists deterministic %s failures as non-retryable', async (failure, expectedMessage) => {
    let rows = await readyRows(1);
    const result = await runBulkFilterImport(rows, vi.fn(async () => {
      throw failure;
    }), (id, update) => {
      rows = rows.map((row) => row.id === id ? { ...row, ...update } : row);
    });

    expect(result).toEqual({ createdCount: 0, failedCount: 1, paused: false });
    expect(rows[0]).toMatchObject({ status: 'failed', message: expectedMessage });
    expect(rows[0]?.remedy).not.toBe('retry');

    const retryCreate = vi.fn(async (_input: FilterCreateInput) => filterFixture);
    await expect(runBulkFilterImport(rows, retryCreate, () => undefined)).resolves.toEqual({
      createdCount: 0,
      failedCount: 0,
      paused: false,
    });
    expect(retryCreate).not.toHaveBeenCalled();
  });

  it.each([
    new ApiFailure(429, 'RATE_LIMITED', 'slow down'),
    new ApiFailure(503, 'SERVICE_UNAVAILABLE', 'offline'),
  ])('keeps transient %s failures eligible for a later run', async (failure) => {
    let rows = await readyRows(1);
    const firstResult = await runBulkFilterImport(rows, vi.fn(async () => {
      throw failure;
    }), (id, update) => {
      rows = rows.map((row) => row.id === id ? { ...row, ...update } : row);
    });

    expect(firstResult).toEqual({ createdCount: 0, failedCount: 1, paused: false });
    expect(rows[0]).toMatchObject({ status: 'failed', remedy: 'retry' });

    const retryCreate = vi.fn(async (_input: FilterCreateInput) => filterFixture);
    await expect(runBulkFilterImport(rows, retryCreate, () => undefined)).resolves.toEqual({
      createdCount: 1,
      failedCount: 0,
      paused: false,
    });
    expect(retryCreate).toHaveBeenCalledTimes(1);
  });

  it('propagates an importing callback exception before creating anything', async () => {
    const rows = await readyRows(1);
    const observerError = new Error('importing observer failed');
    const create = vi.fn(async (_input: FilterCreateInput) => filterFixture);

    await expect(runBulkFilterImport(rows, create, () => {
      throw observerError;
    })).rejects.toBe(observerError);
    expect(create).not.toHaveBeenCalled();
  });

  it('propagates a success callback exception without rewriting the successful create as failed', async () => {
    const rows = await readyRows(2);
    const observerError = new Error('success observer failed');
    const create = vi.fn(async (_input: FilterCreateInput) => filterFixture);
    const statuses: string[] = [];

    await expect(runBulkFilterImport(rows, create, (_id, update) => {
      statuses.push(update.status);
      if (update.status === 'success') throw observerError;
    })).rejects.toBe(observerError);

    expect(create).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['importing', 'success']);
  });

  it('propagates a failure callback exception without starting a later create', async () => {
    const rows = await readyRows(2);
    const observerError = new Error('failure observer failed');
    const create = vi.fn(async () => {
      throw new ApiFailure(400, 'VALIDATION_ERROR', 'invalid');
    });
    const statuses: string[] = [];

    await expect(runBulkFilterImport(rows, create, (_id, update) => {
      statuses.push(update.status);
      if (update.status === 'failed') throw observerError;
    })).rejects.toBe(observerError);

    expect(create).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual(['importing', 'failed']);
  });
});

describe('FilterCatalog lifecycle', () => {
  it('keeps construction inert and balances the committed catalog subscription lifecycle', () => {
    const api = createApi(vi.fn(async () => filterFixture));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryCache = queryClient.getQueryCache();
    const subscribe = queryCache.subscribe.bind(queryCache);
    let activeSubscriptions = 0;
    vi.spyOn(queryCache, 'subscribe').mockImplementation((listener) => {
      activeSubscriptions += 1;
      const unsubscribe = subscribe(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        activeSubscriptions -= 1;
        unsubscribe();
      };
    });

    const abandoned = createFilterCatalog(api, queryClient);
    const committed = createFilterCatalog(api, queryClient);
    try {
      expect(activeSubscriptions).toBe(0);

      committed.activate();
      expect(activeSubscriptions).toBe(1);
      committed.dispose();
      expect(activeSubscriptions).toBe(0);

      committed.activate();
      expect(activeSubscriptions).toBe(1);
      committed.dispose();
      expect(activeSubscriptions).toBe(0);
    } finally {
      committed.dispose();
      abandoned.dispose();
    }
  });
});

describe('useBulkCreateFilters', () => {
  it('calls the API directly and invalidates filters exactly once after a successful run', async () => {
    const rows = await readyRows(2);
    const createFilter = vi.fn(async () => filterFixture);
    const api = createApi(createFilter);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderBulkCreateHook(api, queryClient);

    let runResult;
    await act(async () => {
      runResult = await result.current.run(rows, () => undefined);
    });

    expect(runResult).toEqual({ createdCount: 2, failedCount: 0, paused: false });
    expect(createFilter).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.filters });
    expect(result.current.isPending).toBe(false);
  });

  it('does not invalidate when no filter was created', async () => {
    const rows = await readyRows(1);
    const api = createApi(vi.fn(async () => {
      throw new ApiFailure(409, 'DUPLICATE_NCP', 'duplicate');
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderBulkCreateHook(api, queryClient);

    await act(async () => {
      await result.current.run(rows, () => undefined);
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not silently refresh a zero-known-success ambiguous run', async () => {
    const rows = await readyRows(1);
    const listFilters = vi.fn(async () => [filterFixture]);
    const api = createApi(vi.fn(async () => {
      throw new ApiFailure(0, 'NETWORK_ERROR', 'response lost');
    }), listFilters);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderBulkCreateHook(api, queryClient);

    await act(async () => {
      await result.current.run(rows, () => undefined);
    });

    expect(invalidate).not.toHaveBeenCalled();
    expect(listFilters).not.toHaveBeenCalled();
  });

  it('fetches one authoritative list for reconciliation, updates the cache, and returns it', async () => {
    const authoritative = [{
      ...filterFixture,
      id: 'filter-authoritative',
      ncpSha256: 'ed53222f4a2329c3f42a2dd6391b4b62d1214b1e3eac917d9bd11a8f22f9e43f',
    }];
    const listFilters = vi.fn(async () => authoritative);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, [filterFixture]);
    const { result } = renderBulkCreateHook(
      createApi(vi.fn(async () => filterFixture), listFilters),
      queryClient,
    );
    const reconcile = (result.current as unknown as {
      reconcile?: () => Promise<typeof authoritative>;
    }).reconcile;

    expect(reconcile).toBeTypeOf('function');
    if (!reconcile) return;

    let reconciled: typeof authoritative | undefined;
    await act(async () => {
      reconciled = await reconcile();
    });

    expect(listFilters).toHaveBeenCalledTimes(1);
    expect(reconciled).toEqual(authoritative);
    expect(queryClient.getQueryData(queryKeys.filters)).toEqual(authoritative);
  });

  it('prevents an older same-key query from overwriting reconciliation', async () => {
    const stale = [{ ...filterFixture, id: 'stale-filter', sortOrder: 20 }];
    const authoritative = [{ ...filterFixture, id: 'authoritative-filter', sortOrder: 41 }];
    const olderResponse = deferred<typeof stale>();
    const olderStarted = deferred<void>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, stale);
    const olderQuery = queryClient.fetchQuery({
      queryKey: queryKeys.filters,
      queryFn: ({ signal }) => {
        expect(signal).toBeInstanceOf(AbortSignal);
        olderStarted.resolve();
        return olderResponse.promise;
      },
    });
    const olderSettled = olderQuery.catch((error: unknown) => error);
    await olderStarted.promise;
    const { result } = renderBulkCreateHook(
      createApi(vi.fn(async () => filterFixture), vi.fn(async () => authoritative)),
      queryClient,
    );

    await act(async () => {
      await result.current.reconcile();
    });
    expect(queryClient.getQueryData(queryKeys.filters)).toEqual(authoritative);

    olderResponse.resolve(stale);
    await olderSettled;
    expect(queryClient.getQueryData(queryKeys.filters)).toEqual(authoritative);
  });

  it('owns a normal same-key fetch started while reconciliation cancellation is held', async () => {
    const initial = [{ ...filterFixture, id: 'initial-filter' }];
    const authoritative = [{
      ...filterFixture,
      id: 'committed-filter',
      ncpSha256: 'ed53222f4a2329c3f42a2dd6391b4b62d1214b1e3eac917d9bd11a8f22f9e43f',
    }];
    const cachedResponse = deferred<Response>();
    const cancellation = deferred<void>();
    const filterRequestCaches: Array<RequestCache | undefined> = [];
    let filterRequests = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === '/api/admin/session') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      filterRequests += 1;
      filterRequestCaches.push(init?.cache);
      if (filterRequests === 1) {
        return new Response(JSON.stringify({ filters: initial }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init?.cache === 'no-store') {
        return new Response(JSON.stringify({ filters: authoritative }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return cachedResponse.promise;
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderFilterHooks(new AdminApiClient(fetchImpl), queryClient);
    await waitFor(() => {
      expect(view.result.current.filters.isSuccess).toBe(true);
      expect(view.result.current.filters.isFetching).toBe(false);
    });
    vi.spyOn(queryClient, 'cancelQueries').mockImplementationOnce(() => cancellation.promise);

    let reconciliation!: Promise<AdminFilter[]>;
    act(() => { reconciliation = view.result.current.bulk.reconcile(); });
    await waitFor(() => expect(queryClient.cancelQueries).toHaveBeenCalledTimes(1));
    let normalFetch!: ReturnType<typeof view.result.current.filters.refetch>;
    act(() => { normalFetch = view.result.current.filters.refetch(); });
    await waitFor(() => expect(view.result.current.filters.isFetching).toBe(true));

    cancellation.resolve();
    cachedResponse.resolve(new Response(JSON.stringify({ filters: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    let reconciled: AdminFilter[] | undefined;
    await act(async () => {
      const [filters] = await Promise.all([reconciliation, normalFetch]);
      reconciled = filters;
    });

    expect(reconciled).toEqual(authoritative);
    expect(queryClient.getQueryData(queryKeys.filters)).toEqual(authoritative);
    expect(filterRequestCaches.slice(1)).toEqual(['no-store']);
  });

  it('invalidates reconciliation ownership when filters are removed during held cancellation', async () => {
    const cancellation = deferred<void>();
    let filterRequests = 0;
    const listFilters: AdminApi['listFilters'] = async () => {
      filterRequests += 1;
      return [filterFixture];
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderFilterHooks(
      createApi(vi.fn(async () => filterFixture), listFilters),
      queryClient,
    );
    await waitFor(() => {
      expect(view.result.current.filters.isSuccess).toBe(true);
      expect(view.result.current.filters.isFetching).toBe(false);
    });
    expect(filterRequests).toBe(1);
    vi.spyOn(queryClient, 'cancelQueries').mockImplementationOnce(() => cancellation.promise);

    let reconciliation!: Promise<AdminFilter[]>;
    act(() => { reconciliation = view.result.current.bulk.reconcile(); });
    const settled = reconciliation.catch((error: unknown) => error);
    await waitFor(() => expect(queryClient.cancelQueries).toHaveBeenCalledTimes(1));
    queryClient.removeQueries({ queryKey: queryKeys.filters });
    cancellation.resolve();
    await settled;

    expect(filterRequests).toBe(1);
    expect(queryClient.getQueryData(queryKeys.filters)).toBeUndefined();
  });

  it('bypasses a cached pre-commit response during authoritative reconciliation', async () => {
    const authoritative = [{
      ...filterFixture,
      id: 'committed-filter',
      ncpSha256: 'ed53222f4a2329c3f42a2dd6391b4b62d1214b1e3eac917d9bd11a8f22f9e43f',
    }];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === '/api/admin/session') {
        return new Response(JSON.stringify({ csrfToken: 'csrf-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const filters = init?.cache === 'no-store' ? authoritative : [];
      return new Response(JSON.stringify({ filters }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, [filterFixture]);
    const { result } = renderBulkCreateHook(new AdminApiClient(fetchImpl), queryClient);

    let reconciled: AdminFilter[] | undefined;
    await act(async () => {
      reconciled = await result.current.reconcile();
    });

    expect(reconciled).toEqual(authoritative);
    expect(queryClient.getQueryData(queryKeys.filters)).toEqual(authoritative);
  });

  it('aborts a held reconciliation on unmount without changing cached filters', async () => {
    const cached = [{ ...filterFixture, id: 'cached-filter' }];
    const authoritative = [{ ...filterFixture, id: 'late-authoritative-filter' }];
    const held = deferred<typeof authoritative>();
    const started = deferred<void>();
    let reconciliationSignal: AbortSignal | undefined;
    const listFilters: AdminApi['listFilters'] = (signal) => {
      reconciliationSignal = signal;
      started.resolve();
      return held.promise;
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, cached);
    const view = renderBulkCreateHook(
      createApi(vi.fn(async () => filterFixture), listFilters),
      queryClient,
    );

    let reconciliation!: Promise<AdminFilter[]>;
    act(() => { reconciliation = view.result.current.reconcile(); });
    const settled = reconciliation.catch((error: unknown) => error);
    await started.promise;
    view.unmount();

    expect(reconciliationSignal).toBeInstanceOf(AbortSignal);
    expect(reconciliationSignal?.aborted).toBe(true);
    held.resolve(authoritative);
    await settled;
    expect(queryClient.getQueryData(queryKeys.filters)).toEqual(cached);
  });

  it('cancels only the bulk consumer reconciliation when its page unmounts beneath the session provider', async () => {
    const cached = [{ ...filterFixture, id: 'cached-filter' }];
    const authoritative = [{ ...filterFixture, id: 'late-authoritative-filter' }];
    const held = deferred<typeof authoritative>();
    const started = deferred<void>();
    let reconciliationSignal: AbortSignal | undefined;
    const listFilters: AdminApi['listFilters'] = (signal) => {
      reconciliationSignal = signal;
      started.resolve();
      return held.promise;
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, cached);
    const view = renderBulkCreateConsumer(
      createApi(vi.fn(async () => filterFixture), listFilters),
      queryClient,
    );

    let reconciliation!: Promise<AdminFilter[]>;
    act(() => { reconciliation = view.current().reconcile(); });
    const settled = reconciliation.then(
      (filters) => ({ status: 'fulfilled' as const, filters }),
      (error: unknown) => ({
        status: 'rejected' as const,
        name: error instanceof Error ? error.name : 'unknown',
      }),
    );
    await started.promise;
    act(() => view.unmountConsumer());
    const abortedAfterConsumerUnmount = reconciliationSignal?.aborted;

    held.resolve(authoritative);
    const outcome = await settled;

    expect({
      abortedAfterConsumerUnmount,
      outcome,
      cachedFilters: queryClient.getQueryData(queryKeys.filters),
    }).toEqual({
      abortedAfterConsumerUnmount: true,
      outcome: { status: 'rejected', name: 'AbortError' },
      cachedFilters: cached,
    });
  });

  it('keeps a shared reconciliation alive until its final caller lease is cancelled', async () => {
    const cached = [{ ...filterFixture, id: 'cached-filter' }];
    const authoritative = [{ ...filterFixture, id: 'authoritative-filter' }];
    const held = deferred<typeof authoritative>();
    const started = deferred<void>();
    let reconciliationSignal: AbortSignal | undefined;
    const listFilters: AdminApi['listFilters'] = (signal) => {
      reconciliationSignal = signal;
      started.resolve();
      return held.promise;
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, cached);
    const catalog = createFilterCatalog(
      createApi(vi.fn(async () => filterFixture), listFilters),
      queryClient,
    );
    catalog.activate();
    const departingCaller = new AbortController();
    const remainingCaller = new AbortController();

    try {
      const departing = catalog.reconcile(departingCaller.signal).then(
        (value) => ({ status: 'fulfilled' as const, value }),
        (error: unknown) => ({
          status: 'rejected' as const,
          name: error instanceof Error ? error.name : 'unknown',
        }),
      );
      const remaining = catalog.reconcile(remainingCaller.signal);
      await started.promise;
      departingCaller.abort();
      await Promise.resolve();
      const requestAbortedAfterOneDeparture = reconciliationSignal?.aborted;

      held.resolve(authoritative);

      await expect(departing).resolves.toEqual({ status: 'rejected', name: 'AbortError' });
      await expect(remaining).resolves.toEqual(authoritative);
      expect(requestAbortedAfterOneDeparture).toBe(false);
      expect(queryClient.getQueryData(queryKeys.filters)).toEqual(authoritative);
    } finally {
      catalog.dispose();
    }
  });

  it('does not repopulate filters removed while reconciliation is held', async () => {
    const authoritative = [{ ...filterFixture, id: 'late-authoritative-filter' }];
    const held = deferred<typeof authoritative>();
    const started = deferred<void>();
    let reconciliationSignal: AbortSignal | undefined;
    const listFilters: AdminApi['listFilters'] = (signal) => {
      reconciliationSignal = signal;
      started.resolve();
      return held.promise;
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, [filterFixture]);
    const { result } = renderBulkCreateHook(
      createApi(vi.fn(async () => filterFixture), listFilters),
      queryClient,
    );

    let reconciliation!: Promise<AdminFilter[]>;
    act(() => { reconciliation = result.current.reconcile(); });
    const settled = reconciliation.catch((error: unknown) => error);
    await started.promise;
    queryClient.removeQueries({ queryKey: queryKeys.filters });

    expect(reconciliationSignal).toBeInstanceOf(AbortSignal);
    expect(reconciliationSignal?.aborted).toBe(true);
    held.resolve(authoritative);
    await settled;
    expect(queryClient.getQueryData(queryKeys.filters)).toBeUndefined();
  });

  it('leaves cached filters untouched when authoritative reconciliation fails', async () => {
    const cached = [filterFixture];
    const listFilters = vi.fn(async () => {
      throw new ApiFailure(503, 'INTERNAL', 'list unavailable');
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.filters, cached);
    const { result } = renderBulkCreateHook(
      createApi(vi.fn(async () => filterFixture), listFilters),
      queryClient,
    );

    await act(async () => {
      await expect(result.current.reconcile()).rejects.toMatchObject({ status: 503 });
    });

    expect(listFilters).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(queryKeys.filters)).toEqual(cached);
    expect(result.current.isReconciling).toBe(false);
  });

  it('invalidates once when a paused run created an earlier row', async () => {
    const rows = await readyRows(3);
    const api = createApi(vi.fn()
      .mockResolvedValueOnce(filterFixture)
      .mockRejectedValueOnce(new ApiFailure(0, 'NETWORK_ERROR', 'offline')));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderBulkCreateHook(api, queryClient);

    let runResult;
    await act(async () => {
      runResult = await result.current.run(rows, () => undefined);
    });

    expect(runResult).toEqual({ createdCount: 1, failedCount: 1, paused: true });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.filters });
  });

  it('invalidates once before rethrowing a success observer exception', async () => {
    const rows = await readyRows(2);
    const observerError = new Error('success observer failed');
    const invalidation = deferred<void>();
    const createFilter = vi.fn(async () => filterFixture);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockImplementationOnce(() => invalidation.promise);
    const { result } = renderBulkCreateHook(createApi(createFilter), queryClient);
    let runPromise!: ReturnType<typeof result.current.run>;
    let settled = false;

    act(() => {
      runPromise = result.current.run(rows, (_id, update) => {
        if (update.status === 'success') throw observerError;
      });
    });
    void runPromise.catch(() => { settled = true; });
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));

    expect(createFilter).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.filters });
    expect(settled).toBe(false);
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      invalidation.resolve();
      await expect(runPromise).rejects.toBe(observerError);
    });
    expect(result.current.isPending).toBe(false);
  });

  it('invalidates an earlier success before rethrowing a later importing observer exception', async () => {
    const rows = await readyRows(2);
    const observerError = new Error('later importing observer failed');
    const createFilter = vi.fn(async () => filterFixture);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderBulkCreateHook(createApi(createFilter), queryClient);

    await act(async () => {
      await expect(result.current.run(rows, (id, update) => {
        if (id === 'row-2' && update.status === 'importing') throw observerError;
      })).rejects.toBe(observerError);
    });

    expect(createFilter).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
  });

  it('invalidates an earlier success before rethrowing a later failure observer exception', async () => {
    const rows = await readyRows(2);
    const observerError = new Error('later failure observer failed');
    const createFilter = vi.fn()
      .mockResolvedValueOnce(filterFixture)
      .mockRejectedValueOnce(new ApiFailure(400, 'VALIDATION_ERROR', 'invalid'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderBulkCreateHook(createApi(createFilter), queryClient);

    await act(async () => {
      await expect(result.current.run(rows, (id, update) => {
        if (id === 'row-2' && update.status === 'failed') throw observerError;
      })).rejects.toBe(observerError);
    });

    expect(createFilter).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
  });

  it('reports both observer and invalidation errors and still clears isPending', async () => {
    const rows = await readyRows(1);
    const observerError = new Error('success observer failed');
    const invalidationError = new Error('invalidation failed');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockRejectedValueOnce(invalidationError);
    const { result } = renderBulkCreateHook(createApi(vi.fn(async () => filterFixture)), queryClient);
    let caught: unknown;

    await act(async () => {
      try {
        await result.current.run(rows, (_id, update) => {
          if (update.status === 'success') throw observerError;
        });
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([observerError, invalidationError]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(result.current.isPending).toBe(false);
  });

  it('keeps isPending true until every overlapping run settles', async () => {
    const rows = await readyRows(2);
    const first = deferred<typeof filterFixture>();
    const second = deferred<typeof filterFixture>();
    const api = createApi(vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderBulkCreateHook(api, queryClient);
    let firstRun!: ReturnType<typeof result.current.run>;
    let secondRun!: ReturnType<typeof result.current.run>;

    act(() => {
      firstRun = result.current.run([rows[0]!], () => undefined);
      secondRun = result.current.run([rows[1]!], () => undefined);
    });
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      first.resolve(filterFixture);
      await firstRun;
    });
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      second.resolve(filterFixture);
      await secondRun;
    });
    expect(result.current.isPending).toBe(false);
  });
});
