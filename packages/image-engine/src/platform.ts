export interface DecodedImage {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

export interface EncodeParams {
  type: 'image/jpeg' | 'image/png';
  quality: number;
}

/** Environment abstraction for pixel decode/encode. */
export interface Platform {
  decode(bytes: Uint8Array): Promise<DecodedImage>;
  encode(rgba: Uint8ClampedArray, width: number, height: number, params: EncodeParams): Promise<Uint8Array>;
}

/**
 * Browser implementation. Decodes to RAW pixels (EXIF orientation is applied
 * explicitly by the engine), so behavior matches the Node test platform.
 * NOTE: only runs in a browser (uses DOM APIs); verified by browser e2e tests.
 */
export const browserPlatform: Platform = {
  async decode(bytes: Uint8Array): Promise<DecodedImage> {
    // Browsers apply EXIF orientation automatically at decode (spec §10.1: browser-managed
    // sRGB pixels with EXIF orientation corrected). The engine trusts this oriented output
    // and does NOT re-apply orientation (that would double-rotate). The Node test platform
    // simulates this by applying the parsed EXIF orientation inside nodeDecode.
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return { data: id.data, width: id.width, height: id.height };
  },
  async encode(rgba: Uint8ClampedArray, width: number, height: number, params: EncodeParams): Promise<Uint8Array> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: params.type, quality: params.quality });
    return new Uint8Array(await blob.arrayBuffer());
  },
};
