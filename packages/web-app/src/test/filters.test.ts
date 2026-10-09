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

  it('accepts rows stored without contrast/brightness (schema v1 before those fields)', () => {
    // publicFiltersFixture is exactly such a legacy row: it must keep validating.
    const parsed = publicFiltersFixture.categories[0].filters[0].parsed as Record<string, unknown>;
    expect(parsed.contrast).toBeUndefined();

    expect(toFilterParams(parsePublicFilters(publicFiltersFixture).categories[0].filters[0]).baseMode).toBe('color');
  });

  it('accepts newly parsed rows carrying the 16-bit base code and level fields', () => {
    const upgraded = JSON.parse(JSON.stringify(publicFiltersFixture)) as {
      categories: Array<{ filters: Array<{ parsed: Record<string, unknown> }> }>;
    };
    const parsed = upgraded.categories[0].filters[0].parsed;
    parsed.basePictureControl = { code: 0x064d, name: 'Monochrome' };
    parsed.monochromeFilter = { code: 0x83, name: 'Red' };
    parsed.toningType = { code: 0x84, name: 'Yellow' };
    parsed.toningStrength = 2;
    parsed.contrast = { mode: 'curve', value: 0 };
    parsed.brightness = { mode: 'value', value: 1 };

    const filter = parsePublicFilters(upgraded).categories[0].filters[0];
    expect(filter.parsed.basePictureControl).toEqual({ code: 0x064d, name: 'Monochrome' });

    const params = toFilterParams(filter);
    expect(params.baseMode).toBe('monochrome');
    expect(params.monoFilter?.code).toBe(0x83);
    expect(params.toning?.code).toBe(0x84);
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
