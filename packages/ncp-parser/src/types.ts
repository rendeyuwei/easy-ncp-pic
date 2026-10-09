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

/**
 * An adjustment byte that is not always a plain number: contrast (0x29) and
 * brightness (0x2a) store 0x01 when the custom curve controls the axis and 0x00
 * for Auto; every other byte is 0x80-centered like the remaining adjustments.
 */
export interface AdjustLevel {
  readonly mode: 'curve' | 'auto' | 'value';
  /** 0x80-centered level. Only meaningful when `mode` is 'value'; 0 otherwise. */
  readonly value: number;
}

export interface ParsedPictureControl {
  readonly schemaVersion: 1;
  readonly sourceFormat: 'ncp';
  readonly sourceVersion: number;
  readonly sourceName: string;
  /** `code` is the 16-bit big-endian base Picture Control value read from 0x24..0x25. */
  readonly basePictureControl: EnumValue;
  readonly sharpening: number;
  /**
   * Contrast (0x29) and brightness (0x2a). Optional, not because they are rare in
   * NCP files but because they were added to schema v1 after rows were already
   * stored: `parsed_json` written by the previous parser simply omits both keys,
   * so readers must treat `undefined` as "not decoded" rather than as invalid.
   * Every parse performed by this version writes both.
   */
  readonly contrast?: AdjustLevel;
  /** See contrast. */
  readonly brightness?: AdjustLevel;
  /**
   * Color-adjustment value (0x80-centered). NOT meaningful when
   * basePictureControl is 'Monochrome' — for monochrome bases the source bytes
   * are junk (typically 0xff). Consumers (e.g. the image engine) must key off
   * basePictureControl and ignore saturation/hue for monochrome pictures.
   */
  readonly saturation: number;
  /** See saturation — likewise not meaningful for monochrome bases. */
  readonly hue: number;
  readonly monochromeFilter: EnumValue | null;
  readonly toningType: EnumValue | null;
  readonly toningStrength: number | null;
  readonly customCurve: CustomCurve;
  /** False when any enum could not be mapped; backend refuses to publish. */
  readonly supported: boolean;
  readonly warnings: ReadonlyArray<string>;
}
