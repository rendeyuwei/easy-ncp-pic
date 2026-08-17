import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement, type PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BULK_FILTER_FILES,
  inspectBulkFilterFiles,
  runBulkFilterImport,
  toFilterCreateInput,
  type BulkFilterRow,
} from '../features/filters/filter-bulk-import';
import { useBulkCreateFilters } from '../features/filters/filter-queries';
import { queryKeys } from '../features/query-keys';
import { ApiFailure, type AdminApi, type FilterCreateInput } from '../lib/admin-client';
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

function createApi(createFilter: AdminApi['createFilter']): AdminApi {
  return {
    setUnauthorizedHandler: vi.fn(),
    restoreSession: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    listCategories: vi.fn(async () => [categoryFixture]),
    createCategory: vi.fn(async () => categoryFixture),
    updateCategory: vi.fn(async () => categoryFixture),
    deleteCategory: vi.fn(async () => undefined),
    listFilters: vi.fn(async () => []),
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
  });

  it('marks only later byte-identical files as duplicates', async () => {
    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'one.NCP'),
      fixtureFile(fixture02, 'two.NCP'),
    ], defaults);

    expect(rows.map((row) => [row.fileName, row.status, row.ncpBase64 === null])).toEqual([
      ['one.NCP', 'ready', false],
      ['two.NCP', 'duplicate', false],
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
    rows[1] = { ...rows[1]!, status: 'failed' };
    const first = deferred<typeof filterFixture>();
    const second = deferred<typeof filterFixture>();
    const third = deferred<typeof filterFixture>();
    const create = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);
    const updates: Array<[string, string, string | null]> = [];

    const resultPromise = runBulkFilterImport(rows, create, (id, update) => {
      updates.push([id, update.status, update.message]);
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
      ['row-1', 'importing', null],
      ['row-1', 'success', '已导入'],
      ['row-2', 'importing', null],
      ['row-2', 'duplicate', '该 NCP 已经发布，请选择其他文件'],
      ['row-3', 'importing', null],
      ['row-3', 'success', '已导入'],
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
    expect(rows.map((row) => [row.status, row.message])).toEqual([
      ['success', '已导入'],
      ['failed', '网络连接中断，导入已暂停'],
      ['ready', null],
    ]);
  });

  it('never resubmits successes and skips ineligible, client-invalid, or payload-less rows', async () => {
    const rows = await readyRows(7);
    rows[0] = { ...rows[0]!, status: 'success' };
    rows[1] = { ...rows[1]!, status: 'invalid' };
    rows[2] = { ...rows[2]!, status: 'duplicate' };
    rows[3] = { ...rows[3]!, displayName: ' ' };
    rows[4] = { ...rows[4]!, ncpBase64: null };
    rows[5] = { ...rows[5]!, status: 'failed' };
    const create = vi.fn(async (_input: FilterCreateInput) => filterFixture);
    const updatedIds: string[] = [];

    const result = await runBulkFilterImport(rows, create, (id) => updatedIds.push(id));

    expect(result).toEqual({ createdCount: 2, failedCount: 0, paused: false });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([input]) => input.displayName)).toEqual(['Filter 6', 'Filter 7']);
    expect(updatedIds).toEqual(['row-6', 'row-6', 'row-7', 'row-7']);
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
