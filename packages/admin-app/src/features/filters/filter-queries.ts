import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, type FilterCreateInput, type FilterPatch } from '../../lib/admin-client';
import type { AdminFilter } from '../../lib/api-schema';
import { useSession } from '../../session/session-provider';
import { queryKeys } from '../query-keys';
import {
  runBulkFilterImport,
  type BulkFilterRow,
  type BulkFilterRowUpdater,
  type BulkImportRunResult,
} from './filter-bulk-import';

function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiFailure)) return false;
  if (error.status >= 400 && error.status < 500) return false;
  return error.status === 0
    || error.status >= 500
    || (error.status >= 200 && error.status < 300 && error.code === 'INVALID_RESPONSE');
}

export function useFilters() {
  const { filterCatalog } = useSession();
  return useQuery({
    queryKey: queryKeys.filters,
    queryFn: ({ signal }) => filterCatalog.load(signal),
    retry: (count, error) => count < 1 && isTransient(error),
    retryDelay: 0,
  });
}

function useFilterInvalidation() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: queryKeys.filters });
}

export function useCreateFilter() {
  const { api } = useSession();
  const invalidate = useFilterInvalidation();
  return useMutation({
    mutationFn: (input: FilterCreateInput) => api.createFilter(input),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useBulkCreateFilters(): {
  run(rows: readonly BulkFilterRow[], onRow: BulkFilterRowUpdater): Promise<BulkImportRunResult>;
  reconcile(): Promise<AdminFilter[]>;
  isPending: boolean;
  isReconciling: boolean;
} {
  const { api, filterCatalog } = useSession();
  const queryClient = useQueryClient();
  const activeRuns = useRef(0);
  const activeReconciliations = useRef(0);
  const reconciliationControllers = useRef(new Set<AbortController>());
  const mounted = useRef(false);
  const [isPending, setIsPending] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of reconciliationControllers.current) controller.abort();
      reconciliationControllers.current.clear();
    };
  }, []);

  const run = useCallback(async (
    rows: readonly BulkFilterRow[],
    onRow: BulkFilterRowUpdater,
  ): Promise<BulkImportRunResult> => {
    activeRuns.current += 1;
    setIsPending(true);
    try {
      let committedCount = 0;
      let result: BulkImportRunResult | null = null;
      let coordinatorFailure: { error: unknown } | null = null;
      try {
        result = await runBulkFilterImport(rows, async (input) => {
          const created = await api.createFilter(input);
          committedCount += 1;
          return created;
        }, onRow);
      } catch (error) {
        coordinatorFailure = { error };
      }

      let invalidationFailure: { error: unknown } | null = null;
      if (committedCount > 0) {
        try {
          await queryClient.invalidateQueries({ queryKey: queryKeys.filters });
        } catch (error) {
          invalidationFailure = { error };
        }
      }

      if (coordinatorFailure !== null && invalidationFailure !== null) {
        throw new AggregateError(
          [coordinatorFailure.error, invalidationFailure.error],
          'Bulk import and filter invalidation both failed',
        );
      }
      if (coordinatorFailure !== null) throw coordinatorFailure.error;
      if (invalidationFailure !== null) throw invalidationFailure.error;
      return result!;
    } finally {
      activeRuns.current -= 1;
      if (activeRuns.current === 0) setIsPending(false);
    }
  }, [api, queryClient]);

  const reconcile = useCallback(async (): Promise<AdminFilter[]> => {
    const controller = new AbortController();
    reconciliationControllers.current.add(controller);
    activeReconciliations.current += 1;
    setIsReconciling(true);
    try {
      return await filterCatalog.reconcile(controller.signal);
    } finally {
      reconciliationControllers.current.delete(controller);
      activeReconciliations.current -= 1;
      if (mounted.current && activeReconciliations.current === 0) setIsReconciling(false);
    }
  }, [filterCatalog]);

  return { run, reconcile, isPending, isReconciling };
}

export function useUpdateFilter() {
  const { api } = useSession();
  const invalidate = useFilterInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: FilterPatch }) => api.updateFilter(id, input),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useDeleteFilter() {
  const { api } = useSession();
  const invalidate = useFilterInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.deleteFilter(id),
    retry: false,
    onSuccess: invalidate,
  });
}
