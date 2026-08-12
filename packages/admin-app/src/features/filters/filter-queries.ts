import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, type FilterCreateInput, type FilterPatch } from '../../lib/admin-client';
import { useSession } from '../../session/session-provider';
import { queryKeys } from '../query-keys';

function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiFailure)) return false;
  if (error.status >= 400 && error.status < 500) return false;
  return error.status === 0
    || error.status >= 500
    || (error.status >= 200 && error.status < 300 && error.code === 'INVALID_RESPONSE');
}

export function useFilters() {
  const { api } = useSession();
  return useQuery({
    queryKey: queryKeys.filters,
    queryFn: ({ signal }) => api.listFilters(signal),
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
