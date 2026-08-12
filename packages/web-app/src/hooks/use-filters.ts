import { useQuery } from '@tanstack/react-query';
import { fetchPublicFilters } from '../lib/filters';

export function useFilters() {
  return useQuery({
    queryKey: ['public-filters'],
    queryFn: ({ signal }) => fetchPublicFilters(signal),
    staleTime: 300_000,
    gcTime: 1_800_000,
    retry: 1,
  });
}
