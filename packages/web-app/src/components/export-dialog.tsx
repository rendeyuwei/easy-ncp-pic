import { useEffect, useState } from 'react';
import type { ExportOptions } from '@easypic/image-engine';
import { buildDownloadName, downloadBytes, type DownloadType } from '../lib/download';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export interface ExportDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  sourceName: string;
  sourceType: DownloadType;
  width: number;
  height: number;
  progress: number;
  busy: boolean;
  onExport(options: ExportOptions): Promise<Uint8Array>;
}

export function ExportDialog({
  open,
  onOpenChange,
  sourceName,
  sourceType,
  width,
  height,
  progress,
  busy,
  onExport,
}: ExportDialogProps) {
  const [type, setType] = useState<DownloadType>(sourceType);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const exporting = busy || submitting;

  useEffect(() => {
    if (open) {
      setType(sourceType);
      setError(null);
    }
  }, [open, sourceType]);

  const exportPhoto = async (): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const quality = type === 'image/jpeg' ? 0.92 : undefined;
      const bytes = await onExport({ type, quality });
      downloadBytes(bytes, type, buildDownloadName(sourceName, type));
      onOpenChange(false);
    } catch {
      setError('导出失败。编辑状态已保留，请重试。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !exporting && onOpenChange(nextOpen)}>
      <DialogContent aria-describedby="export-description" showClose={!exporting}>
        <DialogHeader>
          <DialogTitle>导出照片</DialogTitle>
          <DialogDescription id="export-description">
            按原始尺寸导出 · <span>{width} × {height} 像素</span>
          </DialogDescription>
        </DialogHeader>

        <fieldset className="export-formats" disabled={exporting}>
          <legend>文件格式</legend>
          <label>
            <input
              type="radio"
              name="export-type"
              value="image/jpeg"
              aria-label="JPG"
              checked={type === 'image/jpeg'}
              onChange={() => setType('image/jpeg')}
            />
            <span>
              <strong>JPG</strong>
              {type === 'image/jpeg' ? <span>质量 92%</span> : null}
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="export-type"
              value="image/png"
              aria-label="PNG"
              checked={type === 'image/png'}
              onChange={() => setType('image/png')}
            />
            <span><strong>PNG</strong> · 无损</span>
          </label>
        </fieldset>

        {exporting ? (
          <div className="export-progress" role="status" aria-live="polite">
            <span>正在导出 {Math.round(progress * 100)}%</span>
            <progress value={progress} max={1} />
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}

        <DialogFooter>
          <Button variant="secondary" disabled={exporting} onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={exporting} onClick={() => void exportPhoto()}>
            {exporting ? '正在导出…' : '导出照片'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
