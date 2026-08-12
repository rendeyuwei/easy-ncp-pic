import { describe, expect, it, vi } from 'vitest';
import { fetchPublicFilters, parsePublicFilters, toFilterParams } from '../lib/filters';
import { publicFiltersFixture } from './fixtures';

describe('public filter boundary', () => {
  it('validates the API response and maps parsed controls to engine params', () => {
    const response = parsePublicFilters(publicFiltersFixture);
    const filter = response.categories[0].filters[0];

    expect(filter.displayName).toBe('Fuji Astia');
    expect(toFilterParams(filter).curve.size).toBe(257);
  });

  it('rejects malformed public API data before it reaches the editor', () => {
    expect(() => parsePublicFilters({ categories: [{ filters: 'bad' }] })).toThrow(
      'Invalid public filters response',
    );
  });

  it('fetches the cacheable public endpoint with the caller signal', async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(publicFiltersFixture), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(fetchPublicFilters(signal)).resolves.toMatchObject({
      categories: [{ name: '胶片' }],
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/filters', { signal });
  });

  it('surfaces the HTTP status for an unavailable filter API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 503 }));

    await expect(fetchPublicFilters()).rejects.toThrow('Unable to load filters (503)');
  });
});
