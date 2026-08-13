import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PixelBuffer, WorkerLoadedImage } from '@easypic/image-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app';
import { useFilters } from '../hooks/use-filters';
import { useImageSession, type ImageSessionState } from '../hooks/use-image-session';
import { parsePublicFilters } from '../lib/filters';
import { publicFiltersFixture } from './fixtures';

vi.mock('../hooks/use-filters', () => ({ useFilters: vi.fn() }));
vi.mock('../hooks/use-image-session', () => ({ useImageSession: vi.fn() }));
vi.mock('../lib/pixels', () => ({ drawPixelBuffer: vi.fn() }));

const categories = parsePublicFilters(publicFiltersFixture).categories;
const selectedFilter = categories[0].filters[0];
const pendingFilter = { ...selectedFilter, id: 'pending-filter', displayName: 'Pending Filter' };
const pixels: PixelBuffer = { width: 4, height: 3, data: new Float32Array(48) };
const image: WorkerLoadedImage = {
  id: 'image-1',
  width: 6000,
  height: 4000,
  orientation: 1,
  sourceFormat: 'image/jpeg',
};

function session(overrides: Partial<ImageSessionState> = {}): ImageSessionState {
  return {
    image,
    fileName: 'portrait.jpg',
    selectedFilter,
    pendingFilter: null,
    intensity: 1,
    originalPreview: pixels,
    filteredPreview: pixels,
    thumbnails: new Map(),
    thumbnailLoading: new Set(),
    progress: 0,
    progressStage: null,
    busy: false,
    error: null,
    fallbackNotice: null,
    load: vi.fn().mockResolvedValue(undefined),
    selectFilter: vi.fn().mockResolvedValue(undefined),
    setIntensity: vi.fn(),
    exportImage: vi.fn().mockResolvedValue(new Uint8Array([1])),
    reset: vi.fn().mockResolvedValue(undefined),
    requestThumbnails: vi.fn(),
    ...overrides,
  };
}

function filtersResult(error: Error | null = null) {
  return { data: { categories }, error } as ReturnType<typeof useFilters>;
}

describe('App editor integration', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.theme = 'dark';
    vi.mocked(useFilters).mockReturnValue(filtersResult());
    vi.mocked(useImageSession).mockReturnValue(session());
  });

  it('keeps the local upload state available before an image is decoded', () => {
    vi.mocked(useImageSession).mockReturnValue(
      session({ image: null, originalPreview: null, filteredPreview: null }),
    );

    render(<App />);

    expect(screen.getByRole('button', { name: '上传照片' })).toBeInTheDocument();
    expect(screen.getByText('照片不会上传服务器')).toBeInTheDocument();
  });

  it('composes the loaded editor and routes filter/intensity actions', async () => {
    const user = userEvent.setup();
    const state = session();
    vi.mocked(useImageSession).mockReturnValue(state);
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Fuji Astia' })).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Fuji Astia/ }));
    expect(state.selectFilter).toHaveBeenCalledWith(selectedFilter);

    const intensity = screen.getByRole('slider', { name: '滤镜强度' });
    intensity.focus();
    await user.keyboard('{ArrowLeft}');
    expect(state.setIntensity).toHaveBeenCalledWith(0.99);
  });

  it('keeps committed pixels named while announcing and requesting pending filter work', () => {
    const state = session({ pendingFilter });
    vi.mocked(useImageSession).mockReturnValue(state);

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Fuji Astia' })).toBeInTheDocument();
    expect(screen.getByText('正在应用 Pending Filter…')).toBeInTheDocument();
    expect(state.requestThumbnails).toHaveBeenCalledWith(categories[0].filters);
  });

  it('keeps strength interactive for a pending first filter while export stays guarded', async () => {
    const user = userEvent.setup();
    const state = session({
      selectedFilter: null,
      pendingFilter,
      intensity: 0.4,
      busy: true,
    });
    vi.mocked(useImageSession).mockReturnValue(state);

    render(<App />);

    expect(screen.getByText('40%')).toBeInTheDocument();
    const intensity = screen.getByRole('slider', { name: '滤镜强度' });
    intensity.focus();
    await user.keyboard('{ArrowLeft}');
    expect(state.setIntensity).toHaveBeenCalledWith(0.39);
    expect(screen.getByRole('button', { name: '导出' })).toBeDisabled();
  });

  it('shows the original only while the compare control is held', () => {
    render(<App />);
    const compare = screen.getByRole('button', { name: '按住看原图' });

    fireEvent.pointerDown(compare);
    expect(screen.getByTestId('filtered-layer')).toHaveStyle({ clipPath: 'inset(0 0 0 100%)' });
    fireEvent.pointerUp(compare);
    expect(screen.getByTestId('filtered-layer')).toHaveStyle({ clipPath: 'inset(0 0 0 50%)' });

    fireEvent.keyDown(compare, { key: ' ' });
    expect(screen.getByTestId('filtered-layer')).toHaveStyle({ clipPath: 'inset(0 0 0 100%)' });
    fireEvent.keyUp(compare, { key: ' ' });
    expect(screen.getByTestId('filtered-layer')).toHaveStyle({ clipPath: 'inset(0 0 0 50%)' });
  });

  it('opens export and confirms replacing the current photo', async () => {
    const user = userEvent.setup();
    const state = session();
    vi.mocked(useImageSession).mockReturnValue(state);
    render(<App />);

    await user.click(screen.getByRole('button', { name: '导出' }));
    expect(screen.getByRole('dialog', { name: '导出照片' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '关闭' }));

    await user.click(screen.getByRole('button', { name: '更换照片' }));
    expect(screen.getByRole('dialog', { name: '更换照片？' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认更换' }));
    expect(state.reset).toHaveBeenCalledOnce();
  });

  it('keeps a loaded editor visible alongside API and fallback notices', () => {
    vi.mocked(useFilters).mockReturnValue(filtersResult(new Error('503')));
    vi.mocked(useImageSession).mockReturnValue(session({ fallbackNotice: '已切换到兼容模式。' }));

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Fuji Astia' })).toBeInTheDocument();
    expect(screen.getByText('滤镜列表暂时无法更新，请稍后重试。')).toBeInTheDocument();
    expect(screen.getByText('已切换到兼容模式。')).toBeInTheDocument();
  });

  it('persists the light/dark theme preference', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '切换到浅色主题' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('easypic-theme')).toBe('light');
    expect(screen.getByRole('button', { name: '切换到深色主题' })).toBeInTheDocument();
  });
});
