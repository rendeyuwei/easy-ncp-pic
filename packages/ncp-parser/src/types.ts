export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface CustomCurve {
  readonly enabled: boolean;
  readonly gamma: number;
  readonly controlPoints: ReadonlyArray<CurvePoint>;
  /** Length 257, each value normalized to [0, 1]. */
  readonly lut257: ReadonlyArray<number>;
}

/** A raw enum code plus its resolved name ('unknown' when unmapped). */
export interface EnumValue {
  readonly code: number;
  readonly name: string;
}

export interface ParsedPictureControl {
  readonly schemaVersion: 1;
  readonly sourceFormat: 'ncp';
  readonly sourceVersion: number;
  readonly sourceName: string;
  readonly basePictureControl: EnumValue;
  readonly sharpening: number;
  readonly saturation: number;
  readonly hue: number;
  readonly monochromeFilter: EnumValue | null;
  readonly toningType: EnumValue | null;
  readonly toningStrength: number | null;
  readonly customCurve: CustomCurve;
  /** False when any enum could not be mapped; backend refuses to publish. */
  readonly supported: boolean;
  readonly warnings: ReadonlyArray<string>;
}
