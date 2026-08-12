export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isEnabled: boolean;
}

export interface AdminFilter {
  id: string;
  slug: string;
  displayName: string;
  sourceName: string;
  description: string;
  categoryId: string;
  sortOrder: number;
  isEnabled: boolean;
  ncpSha256: string;
  parserVersion: number;
  parsedJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  errors?: Array<{ field: string; message: string }>;
}

export interface SessionResponse {
  csrfToken: string;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid object');
  return value as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== 'string') throw new Error(`Invalid ${key}`);
  return row[key];
}

function integerField(row: Record<string, unknown>, key: string): number {
  if (typeof row[key] !== 'number' || !Number.isFinite(row[key]) || !Number.isInteger(row[key])) {
    throw new Error(`Invalid ${key}`);
  }
  return row[key];
}

function booleanField(row: Record<string, unknown>, key: string): boolean {
  if (typeof row[key] !== 'boolean') throw new Error(`Invalid ${key}`);
  return row[key];
}

function arrayField(row: Record<string, unknown>, key: string): unknown[] {
  if (!Array.isArray(row[key])) throw new Error(`Invalid ${key}`);
  return row[key];
}

function category(value: unknown): AdminCategory {
  const row = record(value);
  return {
    id: stringField(row, 'id'),
    name: stringField(row, 'name'),
    slug: stringField(row, 'slug'),
    sortOrder: integerField(row, 'sortOrder'),
    isEnabled: booleanField(row, 'isEnabled'),
  };
}

function filter(value: unknown): AdminFilter {
  const row = record(value);
  return {
    id: stringField(row, 'id'),
    slug: stringField(row, 'slug'),
    displayName: stringField(row, 'displayName'),
    sourceName: stringField(row, 'sourceName'),
    description: stringField(row, 'description'),
    categoryId: stringField(row, 'categoryId'),
    sortOrder: integerField(row, 'sortOrder'),
    isEnabled: booleanField(row, 'isEnabled'),
    ncpSha256: stringField(row, 'ncpSha256'),
    parserVersion: integerField(row, 'parserVersion'),
    parsedJson: stringField(row, 'parsedJson'),
    createdAt: stringField(row, 'createdAt'),
    updatedAt: stringField(row, 'updatedAt'),
  };
}

function parse<T>(value: unknown, message: string, parser: (row: Record<string, unknown>) => T): T {
  try {
    return parser(record(value));
  } catch {
    throw new Error(message);
  }
}

export function parseSessionResponse(value: unknown): SessionResponse {
  return parse(value, 'Invalid admin session response', (row) => ({ csrfToken: stringField(row, 'csrfToken') }));
}

export function parseCategoryResponse(value: unknown): { category: AdminCategory } {
  return parse(value, 'Invalid admin category response', (row) => ({ category: category(row.category) }));
}

export function parseCategoriesResponse(value: unknown): { categories: AdminCategory[] } {
  return parse(value, 'Invalid admin categories response', (row) => ({
    categories: arrayField(row, 'categories').map(category),
  }));
}

export function parseFilterResponse(value: unknown): { filter: AdminFilter } {
  return parse(value, 'Invalid admin filter response', (row) => ({ filter: filter(row.filter) }));
}

export function parseFiltersResponse(value: unknown): { filters: AdminFilter[] } {
  return parse(value, 'Invalid admin filters response', (row) => ({
    filters: arrayField(row, 'filters').map(filter),
  }));
}

export function parseApiErrorBody(value: unknown): ApiErrorBody {
  return parse(value, 'Invalid API error body', (row) => {
    const body: ApiErrorBody = {
      code: stringField(row, 'code'),
      message: stringField(row, 'message'),
    };

    if (row.errors !== undefined) {
      body.errors = arrayField(row, 'errors').map((entry) => {
        const error = record(entry);
        return { field: stringField(error, 'field'), message: stringField(error, 'message') };
      });
    }

    return body;
  });
}
