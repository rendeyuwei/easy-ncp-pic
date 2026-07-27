export const DEFAULT_PREVIEW_LONG_EDGE = 2048;
export const LOW_MEMORY_PREVIEW_LONG_EDGE = 1280;
export const MAX_SIDE = 10000;
export const MAX_TOTAL_PIXELS = 80_000_000;

/** Scale (without upscaling) so the longest edge is <= maxLongEdge, preserving aspect ratio. */
export function computePreviewSize(
  width: number,
  height: number,
  maxLongEdge: number = DEFAULT_PREVIEW_LONG_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Guard against decompression bombs / browser crashes (spec §10.1). */
export function assertWithinPixelLimits(width: number, height: number): void {
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error(`Image dimension ${Math.max(width, height)}px exceeds the ${MAX_SIDE}px side limit`);
  }
  if (width * height > MAX_TOTAL_PIXELS) {
    throw new Error(`Image total ${width * height} pixels exceeds the ${MAX_TOTAL_PIXELS} pixel limit`);
  }
}

/** EXIF orientations 5-8 rotate 90/270 degrees and therefore swap width/height. */
export function orientationSwapsDimensions(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Pure description of the EXIF orientation transform for the render layer.
 * Returns { rotate (degrees cw), flipH } applied after any dimension swap is handled by the caller.
 */
export function orientationTransform(orientation: number): { rotate: number; flipH: boolean } {
  switch (orientation) {
    case 2: return { rotate: 0, flipH: true };
    case 3: return { rotate: 180, flipH: false };
    case 4: return { rotate: 180, flipH: true };
    case 5: return { rotate: 90, flipH: true };
    case 6: return { rotate: 90, flipH: false };
    case 7: return { rotate: 270, flipH: true };
    case 8: return { rotate: 270, flipH: false };
    default: return { rotate: 0, flipH: false }; // 1 or unknown
  }
}
