import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../errors';

export type AdminBodyMode =
  | 'category-create' | 'category-patch'
  | 'filter-create' | 'filter-patch';

export const SLUG_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$';

const STRING_FIELDS: Record<AdminBodyMode, readonly string[]> = {
  'category-create': ['name', 'slug'],
  'category-patch': ['name', 'slug'],
  'filter-create': ['ncpBase64', 'displayName', 'categoryId', 'description', 'slug'],
  'filter-patch': ['displayName', 'categoryId', 'description', 'slug'],
};

const TRIMMED_FIELDS: Record<AdminBodyMode, readonly string[]> = {
  'category-create': ['name', 'slug'],
  'category-patch': ['name', 'slug'],
  'filter-create': ['displayName', 'description', 'slug'],
  'filter-patch': ['displayName', 'description', 'slug'],
};

function invalidField(field: string, message: string): ApiError {
  return new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', [
    { field, message },
  ]);
}

export function normalizeAdminBody(mode: AdminBodyMode) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (typeof req.body !== 'object' || req.body === null || Array.isArray(req.body)) return;
    const body = req.body as Record<string, unknown>;
    for (const field of STRING_FIELDS[mode]) {
      if (body[field] !== undefined && typeof body[field] !== 'string') {
        throw invalidField(field, 'must be string');
      }
    }
    if (body.isEnabled !== undefined && typeof body.isEnabled !== 'boolean') {
      throw invalidField('isEnabled', 'must be boolean');
    }
    if (body.sortOrder !== undefined && (typeof body.sortOrder !== 'number' || !Number.isInteger(body.sortOrder))) {
      throw invalidField('sortOrder', 'must be integer');
    }
    for (const field of TRIMMED_FIELDS[mode]) {
      if (typeof body[field] === 'string') body[field] = body[field].trim();
    }
    if ((mode === 'category-create' || mode === 'filter-create') && body.slug === '') {
      delete body.slug;
    }
  };
}

export function mapAdminConstraint(error: unknown): ApiError | null {
  const err = error as { code?: string; message?: string };
  if (!err.code?.includes('SQLITE_CONSTRAINT')) return null;
  if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return new ApiError(400, 'VALIDATION_ERROR', 'Invalid category', [
      { field: 'categoryId', message: 'Select an existing category' },
    ]);
  }
  if ((err.message ?? '').includes('ncp_sha256')) {
    return new ApiError(409, 'DUPLICATE_NCP', 'This Picture Control is already published');
  }
  if ((err.message ?? '').includes('slug')) {
    return new ApiError(409, 'SLUG_CONFLICT', 'This slug is already in use', [
      { field: 'slug', message: 'Choose a different slug' },
    ]);
  }
  return null;
}
