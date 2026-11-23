import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PixelBuffer, WorkerLoadedImage } from '@easypic/image-engine';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFilters } from '../hooks/use-filters';
import { useImageSession, type ImageSessionState } from '../hooks/use-image-session';
import { messages } from '../lib/messages';
import { parsePublicFilters } from '../lib/filters';
import { applyDocumentLocale, LocaleProvider } from '../locale-context';
import { createWebRouter } from '../router';
import { UploadScreen } from '../components/upload-screen';
import { publicFiltersFixture } from './fixtures';

vi.mock('../hooks/use-filters', () => ({ useFilters: vi.fn() }));
vi.mock('../hooks/use-image-session', () => ({ useImageSession: vi.fn() }));
vi.mock('../lib/pixels', () => ({ drawPixelBuffer: vi.fn() }));

const categories = parsePublicFilters(publicFiltersFixture).categories;
const pixels: PixelBuffer = { width: 4, height: 3, data: new Float32Array(48) };
const image: WorkerLoadedImage = {
  id: 'image-1',
  width: 64,
  height: 48,
  orientation: 1,
  sourceFormat: 'image/png',
};

function session(): ImageSessionState {
  return {
    image,
    fileName: 'photo.png',
    selectedFilter: categories[0].filters[0],
    pendingFilter: null,
    intensity: 0.99,
    originalPreview: pixels,
    filteredPreview: pixels,
    thumbnails: new Map(),
    thumbnailLoading: new Set(),
    progress: 0,
    progressStage: null,
    busy: false,
    loading: false,
    previewing: false,
    exporting: false,
    error: null,
    fallbackNotice: null,
    load: vi.fn().mockResolvedValue(undefined),
    selectFilter: vi.fn().mockResolvedValue(undefined),
    setIntensity: vi.fn(),
    exportImage: vi.fn().mockResolvedValue(new Uint8Array([1])),
    reset: vi.fn().mockResolvedValue(undefined),
    requestThumbnails: vi.fn(),
  };
}

describe('in-memory language switch', () => {
  beforeEach(() => {
    localStorage.clear();
    document.head.innerHTML = '<meta name="description" content=""><link rel="canonical" href=""><link rel="alternate" hreflang="zh-CN" href="https://rende.fun/easypic/"><link rel="alternate" hreflang="en" href="https://rende.fun/easypic/en/">';
    document.documentElement.setAttribute('data-easypic-prefix', '/easypic');
    vi.mocked(useFilters).mockReturnValue({ data: { categories }, error: null } as ReturnType<typeof useFilters>);
    vi.mocked(useImageSession).mockReturnValue(session());
  });

  it('keeps the editor, comparison, and export choice while the route language changes', async () => {
    const user = userEvent.setup();
    const history = createMemoryHistory({ initialEntries: ['/?album=1#panel'] });
    const router = createWebRouter(history, '/');
    await router.load();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LocaleProvider lang="zh">
          <RouterProvider router={router} />
        </LocaleProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Fuji Astia' })).toBeInTheDocument();
    const compare = screen.getByRole('slider', { name: '原图与滤镜对比' });
    compare.focus();
    await user.keyboard('{ArrowLeft}');
    expect(compare).toHaveAttribute('aria-valuenow', '48');
    await user.click(screen.getByRole('button', { name: '导出' }));
    await user.click(screen.getByRole('radio', { name: 'JPG' }));
    expect(screen.getByRole('radio', { name: 'JPG' })).toBeChecked();

    await router.navigate({ href: '/en/?album=1#panel', resetScroll: false, hashScrollIntoView: false });

    expect(history.location.pathname).toBe('/en/');
    expect(await screen.findByRole('heading', { name: 'Fuji Astia', hidden: true })).toBeInTheDocument();
    expect(screen.getByText('99%')).toBeInTheDocument();
    const englishCompare = screen.getByRole('slider', { name: 'Compare original and filter', hidden: true });
    expect(englishCompare).toHaveAttribute('aria-valuenow', '48');
    expect(englishCompare).toHaveAttribute('aria-valuetext', 'Original 48%');
    expect(screen.getByText('Use the arrow keys to move the divider. Home and End jump to either end.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Export photo' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'JPG' })).toBeChecked();
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://rende.fun/easypic/en/');
    expect(document.querySelector('link[hreflang="zh-CN"]')).toHaveAttribute('href', 'https://rende.fun/easypic/');
    expect(screen.queryByRole('button', { name: '导出', hidden: true })).not.toBeInTheDocument();

    await router.navigate({ href: '/?album=1&lang=zh#panel', resetScroll: false, hashScrollIntoView: false });
    expect(screen.getByRole('dialog', { name: '导出照片' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'JPG' })).toBeChecked();
    expect(screen.getByRole('slider', { name: '原图与滤镜对比', hidden: true })).toHaveAttribute('aria-valuenow', '48');
  });

  it('translates a validation error that is already on screen', () => {
    function Harness({ lang }: { lang: 'zh' | 'en' }) {
      const [name, setName] = useState('');
      return (
        <LocaleProvider lang={lang}>
          <UploadScreen onFile={(file) => setName(file.name)} selectedFileName={name} />
        </LocaleProvider>
      );
    }
    const view = render(<Harness lang="zh" />);
    const input = screen.getByLabelText('选择一张照片');
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByRole('alert')).toHaveTextContent(messages.zh.errors['file-type']);
    view.rerender(<Harness lang="en" />);
    expect(screen.getByRole('alert')).toHaveTextContent(messages.en.errors['file-type']);
    expect(screen.queryByText('notes.txt')).not.toBeInTheDocument();
  });

  it('points canonical metadata at the active language', () => {
    document.documentElement.setAttribute('data-easypic-prefix', '/easypic');
    applyDocumentLocale('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('EasyPic');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(messages.en.description);
  });
});
