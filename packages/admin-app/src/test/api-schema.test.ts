import { describe, expect, it } from 'vitest';
import {
  parseApiErrorBody,
  parseCategoriesResponse,
  parseCategoryResponse,
  parseFilterResponse,
  parseFiltersResponse,
  parseSessionResponse,
} from '../lib/api-schema';
import { categoryFixture, filterFixture } from './fixtures';

describe('admin API response schemas', () => {
  it('returns a valid category list unchanged', () => {
    expect(parseCategoriesResponse({ categories: [categoryFixture] }).categories).toEqual([categoryFixture]);
    expect(parseCategoriesResponse({ categories: [categoryFixture] }).categories[0].slug).toBe('film');
  });

  it('returns a valid singular category unchanged', () => {
    expect(parseCategoryResponse({ category: categoryFixture }).category).toEqual(categoryFixture);
    expect(parseCategoryResponse({ category: categoryFixture }).category.id).toBe(categoryFixture.id);
  });

  it('returns a valid filter list unchanged', () => {
    expect(parseFiltersResponse({ filters: [filterFixture] }).filters).toEqual([filterFixture]);
    expect(parseFiltersResponse({ filters: [filterFixture] }).filters[0].parsedJson).toContain('"schemaVersion":1');
  });

  it('returns a valid singular filter unchanged', () => {
    expect(parseFilterResponse({ filter: filterFixture }).filter).toEqual(filterFixture);
    expect(parseFilterResponse({ filter: filterFixture }).filter.id).toBe(filterFixture.id);
  });

  it('returns a valid session response unchanged', () => {
    expect(parseSessionResponse({ csrfToken: 'abc' })).toEqual({ csrfToken: 'abc' });
  });

  it('rejects a non-boolean filter enabled flag', () => {
    expect(() => parseFiltersResponse({ filters: [{ ...filterFixture, isEnabled: 'yes' }] })).toThrow(
      'Invalid admin filters response',
    );
  });

  it('rejects a non-integer category sort order', () => {
    expect(() => parseCategoriesResponse({ categories: [{ ...categoryFixture, sortOrder: 1.5 }] })).toThrow(
      'Invalid admin categories response',
    );
  });

  it('rejects a singular category with a malformed consumed field', () => {
    expect(() => parseCategoryResponse({ category: { ...categoryFixture, name: 2 } })).toThrow(
      'Invalid admin category response',
    );
  });

  it('rejects a singular filter with a missing consumed field', () => {
    const { updatedAt: _updatedAt, ...filterWithoutUpdatedAt } = filterFixture;

    expect(() => parseFilterResponse({ filter: filterWithoutUpdatedAt })).toThrow('Invalid admin filter response');
  });

  it('rejects a session response without a token', () => {
    expect(() => parseSessionResponse({})).toThrow('Invalid admin session response');
  });

  it('returns known API errors with field errors', () => {
    const body = parseApiErrorBody({
      code: 'VALIDATION_ERROR',
      message: 'Bad input',
      errors: [{ field: 'displayName', message: 'Required' }],
    });

    expect(body.errors?.[0].field).toBe('displayName');
  });

  it('allows newer API error codes with no field errors', () => {
    expect(parseApiErrorBody({ code: 'NEW_SERVER_CODE', message: 'Retry later' })).toEqual({
      code: 'NEW_SERVER_CODE',
      message: 'Retry later',
    });
  });

  it('rejects malformed API field errors', () => {
    expect(() =>
      parseApiErrorBody({
        code: 'VALIDATION_ERROR',
        message: 'Bad input',
        errors: [{ field: 'displayName', message: 2 }],
      }),
    ).toThrow('Invalid API error body');
  });
});
