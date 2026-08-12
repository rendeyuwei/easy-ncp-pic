import type { Platform } from './platform';
import type { FilterParams } from './params';
import type { PixelBuffer } from './pixel';
import { fromUint8Rgba, toUint8Rgba } from './pixel';
import { parseExifOrientation } from './exif';
import { scaleBuffer } from './scale';
import { canvasRenderer, type ImageRenderer } from './renderer';
import { decodeImage, encodeImage, detectImageFormat, DEFAULT_JPEG_QUALITY, type EncodeOptions } from './codec';
import { assertWithinPixelLimits, computePreviewSize, DEFAULT_PREVIEW_LONG_EDGE } from './sizing';

export interface LoadedImage {
  buffer: PixelBuffer; // oriented, full resolution
  width: number;
  height: number;
  orientation: number;
  sourceFormat: 'image/jpeg' | 'image/png';
}

export interface ExportOptions extends EncodeOptions {
  intensity?: number;
}

export interface Engine {
  load(bytes: Uint8Array): Promise<LoadedImage>;
  renderPreview(image: LoadedImage, params: FilterParams, intensity?: number, maxLongEdge?: number): PixelBuffer;
  renderThumbnail(image: LoadedImage, params: FilterParams, size?: number): PixelBuffer;
  exportImage(image: LoadedImage, params: FilterParams, opts?: ExportOptions): Promise<Uint8Array>;
}

export function createEngine(platform: Platform, renderer: ImageRenderer = canvasRenderer): Engine {
  function renderBuffer(buffer: PixelBuffer, params: FilterParams, intensity: number): PixelBuffer {
    const rendered = renderer.render(
      { data: toUint8Rgba(buffer), width: buffer.width, height: buffer.height },
      params,
      intensity,
    );
    return fromUint8Rgba(rendered.data, rendered.width, rendered.height);
  }

  return {
    async load(bytes: Uint8Array): Promise<LoadedImage> {
      // The platform delivers EXIF-ORIENTED pixels (browser auto-orients at decode; the
      // Node test platform simulates it in nodeDecode). The engine does NOT re-apply
      // orientation (that would double-rotate). `orientation` is source metadata only.
      const decoded = await decodeImage(bytes, platform);
      assertWithinPixelLimits(decoded.width, decoded.height);
      const orientation = parseExifOrientation(bytes);
      const sourceFormat = detectImageFormat(bytes);
      const buffer = fromUint8Rgba(decoded.data, decoded.width, decoded.height);
      return { buffer, width: decoded.width, height: decoded.height, orientation, sourceFormat };
    },

    renderPreview(image, params, intensity = 1, maxLongEdge = DEFAULT_PREVIEW_LONG_EDGE): PixelBuffer {
      const sized = computePreviewSize(image.width, image.height, maxLongEdge);
      const scaled = scaleBuffer(image.buffer, sized.width, sized.height);
      return renderBuffer(scaled, params, intensity);
    },

    renderThumbnail(image, params, size = 96): PixelBuffer {
      const sized = computePreviewSize(image.width, image.height, size);
      const scaled = scaleBuffer(image.buffer, sized.width, sized.height);
      return renderBuffer(scaled, params, 1);
    },

    async exportImage(image, params, opts = {}): Promise<Uint8Array> {
      const rendered = renderBuffer(image.buffer, params, opts.intensity ?? 1);
      const type = opts.type ?? image.sourceFormat; // default follows the input format (spec §10.3)
      const quality = opts.quality ?? DEFAULT_JPEG_QUALITY;
      return encodeImage(toUint8Rgba(rendered), rendered.width, rendered.height, { type, quality }, platform);
    },
  };
}
