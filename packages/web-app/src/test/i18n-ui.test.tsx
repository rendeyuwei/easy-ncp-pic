import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExportDialog } from '../components/export-dialog';
import { FilterBrowser } from '../components/filter-browser';
import { UploadScreen } from '../components/upload-screen';
import { LocaleProvider } from '../locale-context';
import type { PublicCategory } from '../lib/filters';

const categories: PublicCategory[] = [{
  id: 'category-film',
  name: '胶片',
  slug: 'film',
  sortOrder: 10,
  filters: [{
    id: 'filter-soft',
    slug: 'soft',
    displayName: '柔光',
    sourceName: '柔光',
    description: '柔和的人像色彩',
    parserVersion: 1,
    parsed: {
      schemaVersion: 1,
      sourceFormat: 'ncp',
      sourceVersion: 100,
      sourceName: '柔光',
      basePictureControl: { code: 2, name: 'Neutral' },
      sharpening: 2,
      saturation: 1,
      hue: 0,
      monochromeFilter: null,
      toningType: null,
      toningStrength: null,
      customCurve: {
        enabled: false,
        gamma: 1,
        controlPoints: [],
        lut257: Array.from({ length: 257 }, (_, index) => index / 256),
      },
      supported: true,
      warnings: [],
    },
  }],
}];

describe('public interface languages', () => {
  it('translates the static chrome and leaves user filter text untouched', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <LocaleProvider lang="en">
        <UploadScreen onFile={vi.fn()} />
        <FilterBrowser
          categories={categories}
          selectedFilterId={null}
          pendingFilterId={null}
          thumbnails={new Map()}
          loadingIds={new Set()}
          onVisibleFiltersChange={vi.fn()}
          onSelect={vi.fn()}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Give the photo the look you want' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '胶片 1' })).toBeInTheDocument();
    const name = screen.getByText('柔光');
    expect(name.closest('[lang="zh"], [lang="zh-CN"]')).toBeNull();
    expect(screen.getByText('柔和的人像色彩')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('上传照片');
    expect(document.body.textContent).not.toContain('暂无预览');
    expect(screen.getByText('No preview')).toBeInTheDocument();

    unmount();
    render(
      <LocaleProvider lang="en">
        <ExportDialog
          open
          onOpenChange={vi.fn()}
          sourceName="portrait.jpg"
          sourceType="image/jpeg"
          width={64}
          height={48}
          progress={0.42}
          busy={false}
          onExport={vi.fn()}
        />
      </LocaleProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Export photo' })).toBeInTheDocument();
    expect(screen.getByText('64 × 48 px')).toBeInTheDocument();
    expect(screen.getByText('Quality 92%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
  });
});
