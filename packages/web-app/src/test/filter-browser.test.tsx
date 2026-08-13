import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PixelBuffer } from '@easypic/image-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicCategory, PublicFilter } from '../lib/filters';
import { parsePublicFilters } from '../lib/filters';
import { publicFiltersFixture } from './fixtures';
import { drawPixelBuffer } from '../lib/pixels';
import { FilterBrowser } from '../components/filter-browser';

vi.mock('../lib/pixels', () => ({ drawPixelBuffer: vi.fn() }));

const filmFilter = parsePublicFilters(publicFiltersFixture).categories[0].filters[0];
const monoFilter: PublicFilter = {
  ...filmFilter,
  id: 'filter-mono',
  slug: 'deep-mono',
  displayName: 'Deep Mono',
  sourceName: 'Deep Mono',
  description: '清晰的黑白层次',
};
const categories: ReadonlyArray<PublicCategory> = [
  parsePublicFilters(publicFiltersFixture).categories[0],
  { id: 'category-mono', name: '黑白', slug: 'mono', sortOrder: 20, filters: [monoFilter] },
];
const thumbnail: PixelBuffer = {
  width: 2,
  height: 2,
  data: new Float32Array(16),
};

describe('FilterBrowser', () => {
  beforeEach(() => vi.mocked(drawPixelBuffer).mockClear());

  it('shows category counts and only the active ordered filter list', async () => {
    const user = userEvent.setup();
    render(
      <FilterBrowser
        categories={categories}
        selectedFilterId={null}
        pendingFilterId={null}
        thumbnails={new Map()}
        loadingIds={new Set()}
        onVisibleFiltersChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('tab', { name: '胶片 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '黑白 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fuji Astia/ })).toBeInTheDocument();
    expect(screen.getByText('柔和的人像色彩')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Deep Mono/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '黑白 1' }));

    expect(screen.getByRole('button', { name: /Deep Mono/ })).toBeInTheDocument();
    expect(screen.getByText('清晰的黑白层次')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fuji Astia/ })).not.toBeInTheDocument();
  });

  it('selects filters by keyboard and exposes current selection', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <FilterBrowser
        categories={categories}
        selectedFilterId={filmFilter.id}
        pendingFilterId={null}
        thumbnails={new Map()}
        loadingIds={new Set()}
        onVisibleFiltersChange={vi.fn()}
        onSelect={onSelect}
      />,
    );
    const filter = screen.getByRole('button', { name: /Fuji Astia/ });

    expect(filter).toHaveAttribute('aria-pressed', 'true');
    filter.focus();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(filmFilter);
  });

  it('draws available thumbnails and labels deterministic placeholders', () => {
    render(
      <FilterBrowser
        categories={categories}
        selectedFilterId={null}
        pendingFilterId={null}
        thumbnails={new Map([[filmFilter.id, thumbnail]])}
        loadingIds={new Set([monoFilter.id])}
        onVisibleFiltersChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(drawPixelBuffer).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), thumbnail);
    expect(screen.getByLabelText('Fuji Astia 滤镜预览')).toBeInTheDocument();
  });

  it('shows loading and missing thumbnail states in their active categories', async () => {
    const user = userEvent.setup();
    render(
      <FilterBrowser
        categories={categories}
        selectedFilterId={null}
        pendingFilterId={null}
        thumbnails={new Map()}
        loadingIds={new Set([monoFilter.id])}
        onVisibleFiltersChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('暂无预览')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '黑白 1' }));
    expect(screen.getByText('正在生成预览')).toBeInTheDocument();
  });

  it('has a useful empty state', () => {
    render(
      <FilterBrowser
        categories={[]}
        selectedFilterId={null}
        pendingFilterId={null}
        thumbnails={new Map()}
        loadingIds={new Set()}
        onVisibleFiltersChange={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('暂无可用滤镜')).toBeInTheDocument();
  });

  it('reports active-category filters and distinguishes pending work from the committed filter', async () => {
    const user = userEvent.setup();
    const onVisibleFiltersChange = vi.fn();
    render(
      <FilterBrowser
        categories={categories}
        selectedFilterId={filmFilter.id}
        pendingFilterId={monoFilter.id}
        thumbnails={new Map()}
        loadingIds={new Set()}
        onVisibleFiltersChange={onVisibleFiltersChange}
        onSelect={vi.fn()}
      />,
    );

    expect(onVisibleFiltersChange).toHaveBeenCalledWith(categories[0].filters);
    expect(screen.getByRole('button', { name: /Fuji Astia/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('tab', { name: '黑白 1' }));

    expect(onVisibleFiltersChange).toHaveBeenLastCalledWith(categories[1].filters);
    expect(screen.getByRole('button', { name: /Deep Mono/ })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('正在应用')).toBeInTheDocument();
  });
});
