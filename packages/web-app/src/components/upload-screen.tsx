import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ImagePlus, LockKeyhole } from 'lucide-react';
import type { AppErrorCode } from '../lib/app-error';
import { fill } from '../lib/messages';
import { useMessages } from '../locale-context';

const ACCEPTED_TYPES = '.jpg,.jpeg,.png,image/jpeg,image/png';

function isSupported(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png' || /\.(?:jpe?g|png)$/i.test(file.name);
}

export interface UploadScreenProps {
  onFile(file: File): void;
  selectedFileName?: string;
  busy?: boolean;
  progress?: number;
  error?: string | null;
}

export function UploadScreen({
  onFile,
  selectedFileName,
  busy = false,
  progress = 0,
  error = null,
}: UploadScreenProps) {
  const copy = useMessages();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [validationCode, setValidationCode] = useState<AppErrorCode | null>(null);
  const validationError = validationCode ? copy.errors[validationCode] : null;

  const acceptFiles = (files: FileList | ReadonlyArray<File>): void => {
    if (busy) return;
    if (files.length !== 1) {
      setValidationCode('file-count');
      return;
    }
    const file = files[0];
    if (!file || !isSupported(file)) {
      setValidationCode('file-type');
      return;
    }
    setValidationCode(null);
    onFile(file);
  };

  const openPicker = (): void => {
    if (!busy) inputRef.current?.click();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (busy) return;
    openPicker();
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (busy) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (busy) return;
    acceptFiles(event.dataTransfer.files);
  };

  return (
    <main className="upload-screen">
      <section className="upload-card" aria-labelledby="upload-title">
        <div className="brand-mark" aria-hidden="true">EP</div>
        <p className="eyebrow">EasyPic</p>
        <h1 id="upload-title">{copy.uploadTitle}</h1>
        <p className="upload-intro">{copy.uploadIntro}</p>

        <div
          className="upload-dropzone"
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-label={copy.uploadAria}
          aria-disabled={busy}
          data-dragging={dragging ? 'true' : 'false'}
          onClick={openPicker}
          onKeyDown={handleKeyDown}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <ImagePlus aria-hidden="true" />
          <strong>{dragging ? copy.dropRelease : copy.dropIdle}</strong>
          <span>{copy.dropHint}</span>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept={ACCEPTED_TYPES}
            aria-label={copy.fileInput}
            disabled={busy}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.currentTarget.files) acceptFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
        </div>

        <p className="privacy-note"><LockKeyhole aria-hidden="true" />{copy.privacyUpload}</p>
        {selectedFileName ? <p className="file-status">{fill(copy.selected, { name: selectedFileName })}</p> : null}
        {busy ? (
          <div role="status">
            <span>{fill(copy.opening, { percent: Math.round(progress * 100) })}</span>
            <progress value={progress} max={1} />
          </div>
        ) : null}
        {validationError || error ? <p role="alert">{validationError ?? error}</p> : null}
      </section>
    </main>
  );
}
