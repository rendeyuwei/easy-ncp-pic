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
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
    let bitmap: ImageBitmap;
    try {
      // Request raw pixels so the engine's explicit orientation handling is correct.
      bitmap = await createImageBitmap(blob, { imageOrientation: 'none' as ImageOrientation });
    } catch {
      bitmap = await createImageBitmap(blob);
    }
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
