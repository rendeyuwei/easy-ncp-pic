import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiFailure, type CategoryInput } from '../../lib/admin-client';
import { useSession } from '../../session/session-provider';
import { queryKeys } from '../query-keys';

function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiFailure)) return false;
  if (error.status >= 400 && error.status < 500) return false;
  return error.status === 0
    || error.status >= 500
    || (error.status >= 200 && error.status < 300 && error.code === 'INVALID_RESPONSE');
}

export function useCategories() {
  const { api } = useSession();
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: ({ signal }) => api.listCategories(signal),
    retry: (count, error) => count < 1 && isTransient(error),
    retryDelay: 0,
  });
}

function useCategoryInvalidation() {
  const queryClient = useQueryClient();
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.categories }),
    queryClient.invalidateQueries({ queryKey: queryKeys.filters }),
  ]);
}

export function useCreateCategory() {
  const { api } = useSession();
  const invalidate = useCategoryInvalidation();
  return useMutation({
    mutationFn: (input: CategoryInput) => api.createCategory(input),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useUpdateCategory() {
  const { api } = useSession();
  const invalidate = useCategoryInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CategoryInput }) => api.updateCategory(id, input),
    retry: false,
    onSuccess: invalidate,
  });
}

export function useDeleteCategory() {
  const { api } = useSession();
  const invalidate = useCategoryInvalidation();
  return useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    retry: false,
    onSuccess: invalidate,
  });
}
