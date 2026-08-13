import { fireEvent, render, screen } from '@testing-library/react';
import type { PixelBuffer } from '@easypic/image-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drawPixelBuffer } from '../lib/pixels';
import { PhotoCompare } from '../components/photo-compare';

vi.mock('../lib/pixels', () => ({
  drawPixelBuffer: vi.fn(),
}));

const original: PixelBuffer = {
  width: 4,
  height: 2,
  data: new Float32Array(4 * 2 * 4),
};

const filtered: PixelBuffer = {
  width: 4,
  height: 2,
  data: new Float32Array(4 * 2 * 4).fill(0.5),
};

describe('PhotoCompare', () => {
  beforeEach(() => vi.mocked(drawPixelBuffer).mockClear());

  it('draws both images and begins at an even comparison', () => {
    render(<PhotoCompare original={original} filtered={filtered} showOriginal={false} />);

    expect(drawPixelBuffer).toHaveBeenCalledTimes(2);
    expect(drawPixelBuffer).toHaveBeenNthCalledWith(1, expect.any(HTMLCanvasElement), original);
    expect(drawPixelBuffer).toHaveBeenNthCalledWith(2, expect.any(HTMLCanvasElement), filtered);
    expect(screen.getByTestId('filtered-layer')).toHaveStyle({ clipPath: 'inset(0 50% 0 0)' });
    expect(screen.getByRole('slider', { name: '原图与滤镜对比' })).toHaveAttribute('aria-valuetext', '滤镜 50%');
  });

  it('places each label over the image shown on that side', () => {
    render(<PhotoCompare original={original} filtered={filtered} showOriginal={false} />);

    expect(screen.getByText('滤镜')).toHaveStyle({ left: '12px' });
    expect(screen.getByText('原图')).toHaveStyle({ right: '12px' });
  });

  it('supports arrow, Home and End keyboard controls', () => {
    render(<PhotoCompare original={original} filtered={filtered} showOriginal={false} />);
    const slider = screen.getByRole('slider', { name: '原图与滤镜对比' });

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider).toHaveAttribute('aria-valuenow', '52');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveAttribute('aria-valuenow', '50');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider).toHaveAttribute('aria-valuenow', '0');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider).toHaveAttribute('aria-valuenow', '100');
  });

  it('converts pointer positions to a clamped percentage', () => {
    render(<PhotoCompare original={original} filtered={filtered} showOriginal={false} />);
    const surface = screen.getByTestId('compare-surface');
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      right: 220,
      top: 0,
      bottom: 100,
      width: 200,
      height: 100,
      x: 20,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(surface, { clientX: 170, pointerId: 1 });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '75');
    fireEvent.pointerMove(surface, { clientX: 300, pointerId: 1 });
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
    fireEvent.pointerUp(surface, { pointerId: 1 });
  });

  it('temporarily shows the whole original image', () => {
    const { rerender } = render(
      <PhotoCompare original={original} filtered={filtered} showOriginal={false} />,
    );
    expect(screen.getByTestId('filtered-layer')).toHaveStyle({ clipPath: 'inset(0 50% 0 0)' });

    rerender(<PhotoCompare original={original} filtered={filtered} showOriginal />);

    expect(screen.getByTestId('filtered-layer')).toHaveStyle({ clipPath: 'inset(0 100% 0 0)' });
    expect(screen.getByTestId('filtered-layer')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByText('滤镜')).not.toBeInTheDocument();
    expect(screen.queryByText('原图')).not.toBeInTheDocument();
  });
});
