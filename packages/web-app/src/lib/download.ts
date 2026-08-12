export type DownloadType = 'image/jpeg' | 'image/png';

export function buildDownloadName(sourceName: string, type: DownloadType): string {
  const base = sourceName.replace(/\.(?:jpe?g|png)$/i, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
  return `${base || 'photo'}-easypic.${type === 'image/jpeg' ? 'jpg' : 'png'}`;
}

export function downloadBytes(bytes: Uint8Array, type: DownloadType, filename: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
