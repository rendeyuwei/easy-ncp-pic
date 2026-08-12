import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDownloadName, downloadBytes } from '../lib/download';
import { ExportDialog } from '../components/export-dialog';

describe('download helpers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('builds safe output names in the selected format', () => {
    expect(buildDownloadName('photo.jpeg', 'image/jpeg')).toBe('photo-easypic.jpg');
    expect(buildDownloadName('my:photo.PNG', 'image/png')).toBe('my-photo-easypic.png');
  });

  it('downloads through a temporary object URL and revokes it after the click', () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:easy-pic');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const append = vi.spyOn(document.body, 'appendChild');

    downloadBytes(new Uint8Array([1, 2, 3]), 'image/png', 'result.png');

    const blob = createObjectURL.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    if (!(blob instanceof Blob)) throw new Error('Expected a Blob download');
    expect(blob.type).toBe('image/png');
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ download: 'result.png' }));
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:easy-pic');
  });
});

describe('ExportDialog', () => {
  beforeEach(() => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:export');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('defaults to the source format and explains JPG quality and dimensions', () => {
    render(
      <ExportDialog
        open
        onOpenChange={vi.fn()}
        sourceName="portrait.jpg"
        sourceType="image/jpeg"
        width={6000}
        height={4000}
        progress={0}
        busy={false}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByRole('radio', { name: 'JPG' })).toBeChecked();
    expect(screen.getByText('质量 92%')).toBeInTheDocument();
    expect(screen.getByText('6000 × 4000 像素')).toBeInTheDocument();
  });

  it('hides quality for PNG and exports, downloads, then closes', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn().mockResolvedValue(new Uint8Array([9, 8, 7]));
    const onOpenChange = vi.fn();
    render(
      <ExportDialog
        open
        onOpenChange={onOpenChange}
        sourceName="portrait.jpg"
        sourceType="image/jpeg"
        width={6000}
        height={4000}
        progress={0}
        busy={false}
        onExport={onExport}
      />,
    );

    await user.click(screen.getByRole('radio', { name: 'PNG' }));
    expect(screen.queryByText('质量 92%')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '导出照片' }));

    expect(onExport).toHaveBeenCalledWith({ type: 'image/png', quality: undefined });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });

  it('announces progress and disables controls while exporting', () => {
    render(
      <ExportDialog
        open
        onOpenChange={vi.fn()}
        sourceName="portrait.png"
        sourceType="image/png"
        width={64}
        height={48}
        progress={0.42}
        busy
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent('正在导出 42%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.42');
    expect(screen.getByRole('radio', { name: 'PNG' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在导出…' })).toBeDisabled();
  });

  it('preserves the dialog and selection when export fails', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <ExportDialog
        open
        onOpenChange={onOpenChange}
        sourceName="portrait.png"
        sourceType="image/png"
        width={64}
        height={48}
        progress={0}
        busy={false}
        onExport={vi.fn().mockRejectedValue(new Error('memory'))}
      />,
    );

    await user.click(screen.getByRole('button', { name: '导出照片' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '导出失败。编辑状态已保留，请重试或改用 JPG。',
    );
    expect(screen.getByRole('radio', { name: 'PNG' })).toBeChecked();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
