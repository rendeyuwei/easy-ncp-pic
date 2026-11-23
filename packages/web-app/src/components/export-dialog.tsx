import { useEffect, useState } from 'react';
import type { ExportOptions } from '@easypic/image-engine';
import { buildDownloadName, downloadBytes, type DownloadType } from '../lib/download';
import { fill } from '../lib/messages';
import { useMessages } from '../locale-context';
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
  const copy = useMessages();
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
      setError(copy.errors['export-failed']);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !exporting && onOpenChange(nextOpen)}>
      <DialogContent aria-describedby="export-description" showClose={!exporting}>
        <DialogHeader>
          <DialogTitle>{copy.exportTitle}</DialogTitle>
          <DialogDescription id="export-description">
            {copy.exportLead} <span>{fill(copy.exportPixels, { width, height })}</span>
          </DialogDescription>
        </DialogHeader>

        <fieldset className="export-formats" disabled={exporting}>
          <legend>{copy.formatLegend}</legend>
          <label>
            <input
              type="radio"
              name="export-type"
              value="image/jpeg"
              aria-label={copy.jpg}
              checked={type === 'image/jpeg'}
              onChange={() => setType('image/jpeg')}
            />
            <span>
              <strong>{copy.jpg}</strong>
              {type === 'image/jpeg' ? <span>{copy.quality}</span> : null}
            </span>
          </label>
          <label>
            <input
              type="radio"
              name="export-type"
              value="image/png"
              aria-label={copy.png}
              checked={type === 'image/png'}
              onChange={() => setType('image/png')}
            />
            <span><strong>{copy.png}</strong> · {copy.lossless}</span>
          </label>
        </fieldset>

        {exporting ? (
          <div className="export-progress" role="status" aria-live="polite">
            <span>{fill(copy.exportingProgress, { percent: Math.round(progress * 100) })}</span>
            <progress value={progress} max={1} />
          </div>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}

        <DialogFooter>
          <Button variant="secondary" disabled={exporting} onClick={() => onOpenChange(false)}>{copy.cancel}</Button>
          <Button disabled={exporting} onClick={() => void exportPhoto()}>
            {exporting ? copy.exporting : copy.exportPhoto}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
