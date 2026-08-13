import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadScreen } from '../components/upload-screen';

describe('UploadScreen', () => {
  it('exposes a labeled JPG/PNG input and local-only privacy copy', () => {
    render(<UploadScreen onFile={vi.fn()} />);

    expect(screen.getByText('照片不会上传服务器')).toBeInTheDocument();
    expect(screen.getByLabelText('选择一张照片')).toHaveAttribute(
      'accept',
      '.jpg,.jpeg,.png,image/jpeg,image/png',
    );
  });

  it('forwards a selected valid photo', async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    render(<UploadScreen onFile={onFile} />);
    const file = new File(['png'], 'portrait.png', { type: 'image/png' });

    await user.upload(screen.getByLabelText('选择一张照片'), file);

    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('supports drag-and-drop and exposes drag state', () => {
    const onFile = vi.fn();
    render(<UploadScreen onFile={onFile} />);
    const dropzone = screen.getByRole('button', { name: '上传照片' });
    const file = new File(['jpg'], 'portrait.jpg', { type: 'image/jpeg' });

    fireEvent.dragEnter(dropzone, { dataTransfer: { files: [file] } });
    expect(dropzone).toHaveAttribute('data-dragging', 'true');
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(onFile).toHaveBeenCalledWith(file);
    expect(dropzone).toHaveAttribute('data-dragging', 'false');
  });

  it('opens the real picker from Enter and Space', () => {
    render(<UploadScreen onFile={vi.fn()} />);
    const input = screen.getByLabelText('选择一张照片');
    const click = vi.spyOn(input, 'click');
    const dropzone = screen.getByRole('button', { name: '上传照片' });

    fireEvent.keyDown(dropzone, { key: 'Enter' });
    fireEvent.keyDown(dropzone, { key: ' ' });

    expect(click).toHaveBeenCalledTimes(2);
  });

  it('rejects multiple or unsupported files with an accessible message', () => {
    const onFile = vi.fn();
    render(<UploadScreen onFile={onFile} />);
    const dropzone = screen.getByRole('button', { name: '上传照片' });

    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [
          new File(['a'], 'a.png', { type: 'image/png' }),
          new File(['b'], 'b.png', { type: 'image/png' }),
        ],
      },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('一次只能处理一张照片');

    fireEvent.drop(dropzone, {
      dataTransfer: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('请选择 JPG 或 PNG 照片');
    expect(onFile).not.toHaveBeenCalled();
  });

  it('ignores picker and drop interactions while loading and reports progress', () => {
    const onFile = vi.fn();
    render(<UploadScreen onFile={onFile} busy progress={0.42} />);
    const input = screen.getByLabelText('选择一张照片');
    const inputClick = vi.spyOn(input, 'click');
    const dropzone = screen.getByRole('button', { name: '上传照片' });
    const file = new File(['png'], 'later.png', { type: 'image/png' });

    fireEvent.click(dropzone);
    fireEvent.keyDown(dropzone, { key: 'Enter' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });

    expect(inputClick).not.toHaveBeenCalled();
    expect(onFile).not.toHaveBeenCalled();
    expect(dropzone).toHaveAttribute('aria-disabled', 'true');
    expect(dropzone).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('status')).toHaveTextContent('正在打开照片 42%');
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0.42');
  });
});
