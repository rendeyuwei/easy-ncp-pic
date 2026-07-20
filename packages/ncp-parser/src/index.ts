export * from './types';
export * from './errors';
export { SCHEMA_VERSION } from './constants';

import { BinaryReader } from './reader';
import { validateStructure } from './validate';
import { readName } from './parse-name';
import { readCurve } from './parse-curve';
import { readAdjustments } from './parse-adjustments';
import { SCHEMA_VERSION, SUPPORTED_MAJOR_VERSION } from './constants';
import type { ParsedPictureControl } from './types';

export function parseNcp(input: Uint8Array): ParsedPictureControl {
  const reader = new BinaryReader(input);
  validateStructure(reader);

  const sourceName = readName(reader);
  const customCurve = readCurve(reader);
  const adj = readAdjustments(reader);

  const supported =
    adj.basePictureControl.name !== 'unknown' &&
    (adj.monochromeFilter === null || adj.monochromeFilter.name !== 'unknown') &&
    (adj.toningType === null || adj.toningType.name !== 'unknown');

  const warnings = [...adj.warnings];
  if (!supported) warnings.push('unsupported NCP variant: unknown enum value');

  return {
    schemaVersion: SCHEMA_VERSION,
    sourceFormat: 'ncp',
    sourceVersion: SUPPORTED_MAJOR_VERSION,
    sourceName,
    basePictureControl: adj.basePictureControl,
    sharpening: adj.sharpening,
    saturation: adj.saturation,
    hue: adj.hue,
    monochromeFilter: adj.monochromeFilter,
    toningType: adj.toningType,
    toningStrength: adj.toningStrength,
    customCurve,
    supported,
    warnings,
  };
}
