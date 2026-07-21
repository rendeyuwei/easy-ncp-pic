import { randomUUID } from 'node:crypto';

/** Lowercase ascii slug; empty for non-latin names (caller supplies a fallback). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** A slug for a display name: the ascii slug, or a short random id for non-latin names. */
export function makeSlug(name: string): string {
  return slugify(name) || randomUUID().slice(0, 8);
}
