import { useEffect, useRef } from 'react';
import type { PixelBuffer } from '@easypic/image-engine';
import type { PublicCategory, PublicFilter } from '../lib/filters';
import { drawPixelBuffer } from '../lib/pixels';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

interface FilterThumbnailProps {
  filter: PublicFilter;
  pixels?: PixelBuffer;
  loading: boolean;
}

function FilterThumbnail({ filter, pixels, loading }: FilterThumbnailProps) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvas.current && pixels) drawPixelBuffer(canvas.current, pixels);
  }, [pixels]);

  if (pixels) {
    return <canvas ref={canvas} className="filter-card__thumbnail" aria-label={`${filter.displayName} 滤镜预览`} />;
  }

  return (
    <span className="filter-card__placeholder" aria-label={`${filter.displayName} 滤镜预览`}>
      {loading ? '正在生成预览' : '暂无预览'}
    </span>
  );
}

export interface FilterBrowserProps {
  categories: ReadonlyArray<PublicCategory>;
  selectedFilterId: string | null;
  thumbnails: ReadonlyMap<string, PixelBuffer>;
  loadingIds: ReadonlySet<string>;
  onSelect(filter: PublicFilter): void;
}

export function FilterBrowser({
  categories,
  selectedFilterId,
  thumbnails,
  loadingIds,
  onSelect,
}: FilterBrowserProps) {
  const firstCategory = categories[0];

  if (!firstCategory) return <p className="filter-browser__empty">暂无可用滤镜</p>;

  return (
    <section className="filter-browser" aria-labelledby="filter-browser-title">
      <h2 id="filter-browser-title">滤镜</h2>
      <Tabs defaultValue={firstCategory.id}>
        <TabsList aria-label="滤镜分类">
          {categories.map((category) => (
            <TabsTrigger key={category.id} value={category.id}>
              {category.name} <span aria-hidden="true">{category.filters.length}</span>
              <span className="visually-hidden"> {category.filters.length}</span>
            </TabsTrigger>
          ))}
        </TabsList>
        {categories.map((category) => (
          <TabsContent key={category.id} value={category.id}>
            <div className="filter-list">
              {category.filters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className="filter-card"
                  aria-pressed={selectedFilterId === filter.id}
                  onClick={() => onSelect(filter)}
                >
                  <FilterThumbnail
                    filter={filter}
                    pixels={thumbnails.get(filter.id)}
                    loading={loadingIds.has(filter.id)}
                  />
                  <span className="filter-card__copy">
                    <strong>{filter.displayName}</strong>
                    <span>{filter.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
