import { BinaryReader } from './reader';
import { ADJ, AUTO_BYTE, CENTER, CURVE_BYTE } from './constants';
import { BASE_PICTURE_CONTROL, MONO_FILTER, TONING_TYPE, enumName } from './enums';
import type { AdjustLevel, EnumValue } from './types';

export interface Adjustments {
  basePictureControl: EnumValue;
  sharpening: number;
  contrast: AdjustLevel;
  brightness: AdjustLevel;
  saturation: number;
  hue: number;
  monochromeFilter: EnumValue | null;
  toningType: EnumValue | null;
  toningStrength: number | null;
  warnings: string[];
}

/**
 * Contrast/brightness byte. 0x01 means the custom curve drives this axis and 0x00
 * means Auto; both have no numeric level, so `value` is 0 and only `mode` carries
 * the information. Any other byte is 0x80-centered like the other adjustments.
 * (Both genuine fixtures store 0x01.)
 */
export function decodeCurveLevel(byte: number): AdjustLevel {
  if (byte === AUTO_BYTE) return { mode: 'auto', value: 0 };
  if (byte === CURVE_BYTE) return { mode: 'curve', value: 0 };
  return { mode: 'value', value: byte - CENTER };
}

/**
 * Sharpening/saturation byte: 0x00 means Auto. The engine has no auto model for
 * those axes, so Auto is approximated as 0 (neutral) and recorded as a warning.
 */
function decodeAutoCentered(byte: number, label: string, warnings: string[]): number {
  if (byte === AUTO_BYTE) {
    warnings.push(`auto ${label} approximated as 0`);
    return 0;
  }
  return byte - CENTER;
}

export function readAdjustments(reader: BinaryReader): Adjustments {
  const warnings: string[] = [];

  // 16-bit big-endian code: PICCON02 stores 0x03c2 (Neutral), PICCON33 0x064d
  // (Monochrome). A single-byte read would collide Standard/Vivid and
  // Portrait/Landscape, which share their high byte.
  const basePictureControl = enumName(BASE_PICTURE_CONTROL, reader.uint16BE(ADJ.base));
  if (basePictureControl.name === 'unknown') {
    warnings.push(`unknown base Picture Control code ${basePictureControl.code}`);
  }

  const sharpening = decodeAutoCentered(reader.uint8(ADJ.sharpening), 'sharpening', warnings);
  const contrast = decodeCurveLevel(reader.uint8(ADJ.contrast));
  const brightness = decodeCurveLevel(reader.uint8(ADJ.brightness));
  // saturation/hue are color-mode adjustments. For monochrome bases the source
  // bytes are junk (typically 0xff -> 127); they are decoded and returned
  // verbatim, but consumers must ignore them when basePictureControl is
  // 'Monochrome' (see ParsedPictureControl.saturation in types.ts).
  const saturation = decodeAutoCentered(reader.uint8(ADJ.saturation), 'saturation', warnings);
  const hue = reader.uint8(ADJ.hue) - CENTER;

  let monochromeFilter: EnumValue | null = null;
  let toningType: EnumValue | null = null;
  let toningStrength: number | null = null;

  if (basePictureControl.name === 'Monochrome') {
    monochromeFilter = enumName(MONO_FILTER, reader.uint8(ADJ.monoFilter));
    if (monochromeFilter.name === 'unknown') {
      warnings.push(`unknown monochrome filter code ${monochromeFilter.code}`);
    }
    toningType = enumName(TONING_TYPE, reader.uint8(ADJ.toningType));
    if (toningType.name === 'unknown') {
      warnings.push(`unknown toning type code ${toningType.code}`);
    }
    toningStrength = reader.uint8(ADJ.toningStrength) - CENTER;
  }

  return {
    basePictureControl,
    sharpening,
    contrast,
    brightness,
    saturation,
    hue,
    monochromeFilter,
    toningType,
    toningStrength,
    warnings,
  };
}
