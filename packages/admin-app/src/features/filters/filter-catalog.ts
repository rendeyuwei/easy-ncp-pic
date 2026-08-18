import type { QueryClient } from '@tanstack/react-query';
import type { AdminApi } from '../../lib/admin-client';
import type { AdminFilter } from '../../lib/api-schema';
import { queryKeys } from '../query-keys';

export interface FilterCatalogSnapshot {
  readonly filters: readonly AdminFilter[];
  isCurrent(): boolean;
}

export interface FilterCatalog {
  activate(): void;
  load(signal?: AbortSignal): Promise<AdminFilter[]>;
  capture(): FilterCatalogSnapshot | null;
  reconcile(signal: AbortSignal): Promise<AdminFilter[]>;
  dispose(): void;
}

interface ReconciliationOwner {
  readonly controller: AbortController;
  readonly participants: Set<symbol>;
  readonly promise: Promise<AdminFilter[]>;
  resolve(filters: AdminFilter[]): void;
  reject(error: unknown): void;
}

function cancelled(): Error {
  const error = new Error('Filter catalog authority was cancelled');
  error.name = 'AbortError';
  return error;
}

export function createFilterCatalog(api: AdminApi, queryClient: QueryClient): FilterCatalog {
  const queryCache = queryClient.getQueryCache();
  const queryHash = queryClient.defaultQueryOptions({ queryKey: queryKeys.filters }).queryHash;
  let epoch = 0;
  let disposed = false;
  let owner: ReconciliationOwner | null = null;
  let unsubscribe: (() => void) | null = null;

  const invalidateOwner = () => {
    const current = owner;
    if (!current) return;
    owner = null;
    epoch += 1;
    current.controller.abort();
    current.reject(cancelled());
  };

  const subscribe = () => {
    if (unsubscribe) return;
    unsubscribe = queryCache.subscribe((event) => {
      if (event.query.queryHash !== queryHash) return;
      if (event.type === 'added' || event.type === 'removed' || event.type === 'updated') {
        epoch += 1;
      }
      if (event.type === 'removed') invalidateOwner();
    });
  };

  const owns = (candidate: ReconciliationOwner): boolean => (
    !disposed && owner === candidate && !candidate.controller.signal.aborted
  );

  const settle = (
    candidate: ReconciliationOwner,
    outcome: { filters: AdminFilter[] } | { error: unknown },
  ) => {
    if (owner !== candidate) return;
    owner = null;
    epoch += 1;
    if ('filters' in outcome) candidate.resolve(outcome.filters);
    else candidate.reject(outcome.error);
  };

  const executeReconciliation = async (candidate: ReconciliationOwner) => {
    try {
      await queryClient.cancelQueries({ queryKey: queryKeys.filters, exact: true });
      if (!owns(candidate)) throw cancelled();
      const filters = await api.listFilters(candidate.controller.signal, 'no-store');
      if (!owns(candidate)) throw cancelled();
      queryClient.setQueryData<AdminFilter[]>(queryKeys.filters, filters);
      settle(candidate, { filters });
    } catch (error) {
      settle(candidate, { error });
    }
  };

  const participate = (
    candidate: ReconciliationOwner,
    signal: AbortSignal,
  ): Promise<AdminFilter[]> => {
    if (signal.aborted) return Promise.reject(cancelled());
    const participant = Symbol('filter-catalog-reconciliation');
    candidate.participants.add(participant);
    return new Promise<AdminFilter[]>((resolve, reject) => {
      let active = true;
      const release = () => {
        if (!active) return false;
        active = false;
        candidate.participants.delete(participant);
        signal.removeEventListener('abort', onAbort);
        return true;
      };
      const onAbort = () => {
        if (!release()) return;
        reject(cancelled());
        if (owner === candidate && candidate.participants.size === 0) invalidateOwner();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      candidate.promise.then(
        (filters) => {
          if (!release()) return;
          resolve(filters);
        },
        (error: unknown) => {
          if (!release()) return;
          reject(error);
        },
      );
      if (signal.aborted) onAbort();
    });
  };

  return {
    activate() {
      if (disposed) {
        disposed = false;
        epoch += 1;
      }
      subscribe();
    },

    load(signal) {
      if (disposed) return Promise.reject(cancelled());
      subscribe();
      return owner?.promise ?? api.listFilters(signal);
    },

    capture() {
      if (disposed || !unsubscribe || owner) return null;
      const query = queryCache.find<AdminFilter[]>({ queryKey: queryKeys.filters, exact: true });
      if (!query
        || query.state.status !== 'success'
        || query.state.fetchStatus !== 'idle'
        || query.state.isInvalidated
        || !query.state.data) {
        return null;
      }
      const capturedEpoch = epoch;
      const capturedData = query.state.data;
      return {
        filters: capturedData,
        isCurrent: () => {
          const current = queryCache.find<AdminFilter[]>({ queryKey: queryKeys.filters, exact: true });
          return !disposed
            && !owner
            && epoch === capturedEpoch
            && current === query
            && current.state.data === capturedData
            && current.state.status === 'success'
            && current.state.fetchStatus === 'idle'
            && !current.state.isInvalidated;
        },
      };
    },

    reconcile(signal) {
      if (disposed) return Promise.reject(cancelled());
      if (signal.aborted) return Promise.reject(cancelled());
      subscribe();
      if (owner) return participate(owner, signal);
      const protectedQuery = queryCache.find({ queryKey: queryKeys.filters, exact: true });
      if (!protectedQuery) return Promise.reject(cancelled());
      let resolve!: (filters: AdminFilter[]) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<AdminFilter[]>((next, fail) => {
        resolve = next;
        reject = fail;
      });
      const candidate: ReconciliationOwner = {
        controller: new AbortController(),
        participants: new Set(),
        promise,
        resolve,
        reject,
      };
      owner = candidate;
      epoch += 1;
      void executeReconciliation(candidate);
      return participate(candidate, signal);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      epoch += 1;
      invalidateOwner();
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}
