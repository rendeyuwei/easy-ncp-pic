import { luminance, rgbToHsl, hslToRgb } from './color';

/** Saturation: amount is the NCP value (0x80-centered). factor = 1 + amount*0.1 (0 => no change). */
export function applySaturation(r: number, g: number, b: number, amount: number): [number, number, number] {
  const factor = 1 + amount * 0.1;
  const luma = luminance(r, g, b);
  return [luma + (r - luma) * factor, luma + (g - luma) * factor, luma + (b - luma) * factor];
}

/** Hue rotation: amount is the NCP value (0x80-centered). degrees = amount*5. */
export function applyHue(r: number, g: number, b: number, amount: number): [number, number, number] {
  const degrees = amount * 5;
  if (degrees === 0) return [r, g, b];
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s === 0) return [r, g, b]; // gray has no hue
  const h2 = (h + degrees / 360) % 1;
  return hslToRgb(h2 < 0 ? h2 + 1 : h2, s, l);
}
