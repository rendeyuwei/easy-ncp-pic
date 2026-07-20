import { BinaryReader } from './reader';
import { ADJ, CENTER } from './constants';
import { BASE_PICTURE_CONTROL, MONO_FILTER, TONING_TYPE, enumName } from './enums';
import type { EnumValue } from './types';

export interface Adjustments {
  basePictureControl: EnumValue;
  sharpening: number;
  saturation: number;
  hue: number;
  monochromeFilter: EnumValue | null;
  toningType: EnumValue | null;
  toningStrength: number | null;
  warnings: string[];
}

export function readAdjustments(reader: BinaryReader): Adjustments {
  const warnings: string[] = [];

  const basePictureControl = enumName(BASE_PICTURE_CONTROL, reader.uint8(ADJ.base));
  if (basePictureControl.name === 'unknown') {
    warnings.push(`unknown base Picture Control code ${basePictureControl.code}`);
  }

  const sharpening = reader.uint8(ADJ.sharpening) - CENTER;
  const saturation = reader.uint8(ADJ.saturation) - CENTER;
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

  return { basePictureControl, sharpening, saturation, hue, monochromeFilter, toningType, toningStrength, warnings };
}
