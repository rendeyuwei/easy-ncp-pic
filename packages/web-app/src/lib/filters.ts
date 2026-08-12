import { fromParsedPictureControl, type FilterParams } from '@easypic/image-engine';

interface EnumValue {
  readonly code: number;
  readonly name: string;
}

interface ParsedPictureControlPayload {
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
  readonly customCurve: {
    readonly enabled: boolean;
    readonly gamma: number;
    readonly controlPoints: ReadonlyArray<{ readonly x: number; readonly y: number }>;
    readonly lut257: ReadonlyArray<number>;
  };
  readonly supported: true;
  readonly warnings: ReadonlyArray<string>;
}

export interface PublicFilter {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly sourceName: string;
  readonly description: string;
  readonly parserVersion: number;
  readonly parsed: ParsedPictureControlPayload;
}

export interface PublicCategory {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly sortOrder: number;
  readonly filters: ReadonlyArray<PublicFilter>;
}

export interface PublicFiltersResponse {
  readonly categories: ReadonlyArray<PublicCategory>;
}

function invalid(): never {
  throw new Error('Invalid public filters response');
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string') invalid();
  return value;
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function enumValue(value: unknown): EnumValue {
  const item = record(value);
  return { code: number(item.code), name: string(item.name) };
}

function optionalEnum(value: unknown): EnumValue | null {
  return value === null ? null : enumValue(value);
}

function parsedControl(value: unknown): ParsedPictureControlPayload {
  const parsed = record(value);
  const curve = record(parsed.customCurve);
  const lut257 = array(curve.lut257).map(number);
  if (lut257.length !== 257) invalid();
  const schemaVersion = number(parsed.schemaVersion);
  const sourceFormat = string(parsed.sourceFormat);
  if (schemaVersion !== 1 || sourceFormat !== 'ncp' || parsed.supported !== true) invalid();

  return {
    schemaVersion: 1,
    sourceFormat: 'ncp',
    sourceVersion: number(parsed.sourceVersion),
    sourceName: string(parsed.sourceName),
    basePictureControl: enumValue(parsed.basePictureControl),
    sharpening: number(parsed.sharpening),
    saturation: number(parsed.saturation),
    hue: number(parsed.hue),
    monochromeFilter: optionalEnum(parsed.monochromeFilter),
    toningType: optionalEnum(parsed.toningType),
    toningStrength: parsed.toningStrength === null ? null : number(parsed.toningStrength),
    customCurve: {
      enabled: boolean(curve.enabled),
      gamma: number(curve.gamma),
      controlPoints: array(curve.controlPoints).map((point) => {
        const item = record(point);
        return { x: number(item.x), y: number(item.y) };
      }),
      lut257,
    },
    supported: true,
    warnings: array(parsed.warnings).map(string),
  };
}

function publicFilter(value: unknown): PublicFilter {
  const filter = record(value);
  return {
    id: string(filter.id),
    slug: string(filter.slug),
    displayName: string(filter.displayName),
    sourceName: string(filter.sourceName),
    description: string(filter.description),
    parserVersion: number(filter.parserVersion),
    parsed: parsedControl(filter.parsed),
  };
}

function publicCategory(value: unknown): PublicCategory {
  const category = record(value);
  return {
    id: string(category.id),
    name: string(category.name),
    slug: string(category.slug),
    sortOrder: number(category.sortOrder),
    filters: array(category.filters).map(publicFilter),
  };
}

export function parsePublicFilters(value: unknown): PublicFiltersResponse {
  const response = record(value);
  return { categories: array(response.categories).map(publicCategory) };
}

export function toFilterParams(filter: PublicFilter): FilterParams {
  return fromParsedPictureControl(
    filter.parsed as Parameters<typeof fromParsedPictureControl>[0],
  );
}

export async function fetchPublicFilters(signal?: AbortSignal): Promise<PublicFiltersResponse> {
  const response = await fetch('/api/filters', { signal });
  if (!response.ok) throw new Error(`Unable to load filters (${response.status})`);
  return parsePublicFilters(await response.json());
}
