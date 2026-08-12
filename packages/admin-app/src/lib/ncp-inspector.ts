import { NcpParseError, parseNcp, type ParsedPictureControl } from '@easypic/ncp-parser';

export const MAX_NCP_FILE_BYTES = 64 * 1024;

export type NcpInspectionErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_NCP'
  | 'UNSUPPORTED_NCP';

export interface NcpInspection {
  fileName: string;
  bytes: Uint8Array;
  parsed: ParsedPictureControl;
  summary: {
    sourceName: string;
    sourceVersion: number;
    schemaVersion: number;
    baseMode: string;
    curveEnabled: boolean;
    controlPointCount: number;
    lutSize: number;
    warnings: readonly string[];
  };
}

export class NcpInspectionError extends Error {
  constructor(
    readonly code: NcpInspectionErrorCode,
    message: string,
    readonly inspection?: NcpInspection,
  ) {
    super(message);
    this.name = 'NcpInspectionError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export async function inspectNcpFile(file: File): Promise<NcpInspection> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) {
    throw new NcpInspectionError('EMPTY_FILE', '请选择一个非空的 NCP 文件。');
  }
  if (bytes.length > MAX_NCP_FILE_BYTES) {
    throw new NcpInspectionError('FILE_TOO_LARGE', 'NCP 文件不能超过 64 KiB。');
  }

  let parsed: ParsedPictureControl;
  try {
    parsed = parseNcp(bytes);
  } catch (error) {
    if (error instanceof NcpParseError) {
      throw new NcpInspectionError('INVALID_NCP', error.message);
    }
    throw error;
  }

  const inspection: NcpInspection = {
    fileName: file.name,
    bytes,
    parsed,
    summary: {
      sourceName: parsed.sourceName,
      sourceVersion: parsed.sourceVersion,
      schemaVersion: parsed.schemaVersion,
      baseMode: parsed.basePictureControl.name,
      curveEnabled: parsed.customCurve.enabled,
      controlPointCount: parsed.customCurve.controlPoints.length,
      lutSize: parsed.customCurve.lut257.length,
      warnings: parsed.warnings,
    },
  };

  if (!parsed.supported) {
    throw new NcpInspectionError(
      'UNSUPPORTED_NCP',
      '该 NCP 使用了当前版本不支持的参数，不能发布。',
      inspection,
    );
  }

  return inspection;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const chunk = bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function string(value: unknown): value is string {
  return typeof value === 'string';
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function enumValue(value: unknown): value is { code: number; name: string } {
  const item = record(value);
  return item !== null && Number.isInteger(item.code) && string(item.name);
}

function curvePoint(value: unknown): value is { x: number; y: number } {
  const point = record(value);
  return point !== null && number(point.x) && number(point.y);
}

function optionalEnum(value: unknown): value is { code: number; name: string } | null {
  return value === null || enumValue(value);
}

function optionalNumber(value: unknown): value is number | null {
  return value === null || number(value);
}

function isParsedPictureControl(value: unknown): value is ParsedPictureControl {
  const parsed = record(value);
  if (
    parsed === null ||
    parsed.schemaVersion !== 1 ||
    parsed.sourceFormat !== 'ncp' ||
    !Number.isInteger(parsed.sourceVersion) ||
    !string(parsed.sourceName) ||
    !enumValue(parsed.basePictureControl) ||
    !number(parsed.sharpening) ||
    !number(parsed.saturation) ||
    !number(parsed.hue) ||
    !optionalEnum(parsed.monochromeFilter) ||
    !optionalEnum(parsed.toningType) ||
    !optionalNumber(parsed.toningStrength) ||
    typeof parsed.supported !== 'boolean' ||
    !Array.isArray(parsed.warnings) ||
    !parsed.warnings.every(string)
  ) return false;

  const curve = record(parsed.customCurve);
  if (
    curve === null ||
    typeof curve.enabled !== 'boolean' ||
    !number(curve.gamma) ||
    !Array.isArray(curve.controlPoints) ||
    !curve.controlPoints.every(curvePoint) ||
    !Array.isArray(curve.lut257) ||
    curve.lut257.length !== 257 ||
    !curve.lut257.every(number)
  ) return false;

  const monochrome = parsed.basePictureControl.name === 'Monochrome';
  return monochrome
    ? parsed.monochromeFilter !== null && parsed.toningType !== null && parsed.toningStrength !== null
    : parsed.monochromeFilter === null && parsed.toningType === null && parsed.toningStrength === null;
}

export function parseStoredPictureControl(json: string): ParsedPictureControl | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isParsedPictureControl(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
