import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { ImagePlus, LockKeyhole } from 'lucide-react';

const ACCEPTED_TYPES = '.jpg,.jpeg,.png,image/jpeg,image/png';

function isSupported(file: File): boolean {
  return file.type === 'image/jpeg' || file.type === 'image/png' || /\.(?:jpe?g|png)$/i.test(file.name);
}

export interface UploadScreenProps {
  onFile(file: File): void;
  selectedFileName?: string;
  busy?: boolean;
  error?: string | null;
}

export function UploadScreen({ onFile, selectedFileName, busy = false, error = null }: UploadScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const acceptFiles = (files: FileList | ReadonlyArray<File>): void => {
    if (files.length !== 1) {
      setValidationError('一次只能处理一张照片。');
      return;
    }
    const file = files[0];
    if (!file || !isSupported(file)) {
      setValidationError('请选择 JPG 或 PNG 照片。');
      return;
    }
    setValidationError(null);
    onFile(file);
  };

  const openPicker = (): void => inputRef.current?.click();

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openPicker();
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
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
    acceptFiles(event.dataTransfer.files);
  };

  return (
    <main className="upload-screen">
      <section className="upload-card" aria-labelledby="upload-title">
        <div className="brand-mark" aria-hidden="true">EP</div>
        <p className="eyebrow">EasyPic</p>
        <h1 id="upload-title">让照片呈现你想要的质感</h1>
        <p className="upload-intro">选择一张照片，在浏览器里预览并应用精选滤镜。</p>

        <div
          className="upload-dropzone"
          role="button"
          tabIndex={0}
          aria-label="上传照片"
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
          <strong>{dragging ? '松开即可打开照片' : '点击或拖放照片到这里'}</strong>
          <span>支持 JPG、PNG，一次一张</span>
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept={ACCEPTED_TYPES}
            aria-label="选择一张照片"
            disabled={busy}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.currentTarget.files) acceptFiles(event.currentTarget.files);
              event.currentTarget.value = '';
            }}
          />
        </div>

        <p className="privacy-note"><LockKeyhole aria-hidden="true" />照片不会上传服务器</p>
        {selectedFileName ? <p className="file-status">已选择：{selectedFileName}</p> : null}
        {busy ? <p role="status">正在打开照片…</p> : null}
        {validationError || error ? <p role="alert">{validationError ?? error}</p> : null}
      </section>
    </main>
  );
}
