import { REC709 } from './color';

/**
 * Monochrome filter-effect channel weights, keyed by NCP filter code (0x80-centered enum).
 * Documented, testable approximations (spec §10.2 "明确、可测试的亮度权重"); not Nikon-exact (spec §1.2).
 */
export const MONO_FILTER_WEIGHTS: Readonly<Record<number, readonly [number, number, number]>> = {
  0x80: REC709, // None
  0x81: [0.33, 0.6, 0.07], // Yellow
  0x82: [0.5, 0.45, 0.05], // Orange
  0x83: [0.7, 0.3, 0.0], // Red
  0x84: [0.1, 0.8, 0.1], // Green
  0x85: [0.0, 0.3, 0.7], // Blue
};

/** Toning tint colors, keyed by NCP toning code. 0x80 = None (no tint). Documented approximations. */
export const TONING_COLORS: Readonly<Record<number, readonly [number, number, number]>> = {
  0x81: [0.76, 0.6, 0.42], // Sepia
  0x82: [0.5, 0.7, 0.7], // Cyan
  0x83: [0.7, 0.5, 0.7], // Magenta
  0x84: [0.7, 0.7, 0.5], // Yellow
  0x85: [0.5, 0.7, 0.5], // Green
  0x86: [0.5, 0.5, 0.7], // Blue
};

export function filterWeightsFor(code: number): readonly [number, number, number] {
  return MONO_FILTER_WEIGHTS[code] ?? REC709;
}

export function toningColorFor(code: number): readonly [number, number, number] | null {
  return TONING_COLORS[code] ?? null;
}

export function monoToGray(r: number, g: number, b: number, weights: readonly [number, number, number]): number {
  return weights[0] * r + weights[1] * g + weights[2] * b;
}

/** Tint a grayscale value toward `color`, scaled by strength (NCP toning strength, 0..~3). */
export function applyToning(
  gray: number,
  color: readonly [number, number, number],
  strength: number,
): [number, number, number] {
  const t = Math.min(1, Math.max(0, strength * 0.1));
  return [gray * (1 - t) + color[0] * t, gray * (1 - t) + color[1] * t, gray * (1 - t) + color[2] * t];
}
