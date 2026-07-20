export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  isEnabled: boolean;
}
export interface NewCategory {
  name: string;
  slug?: string;
  sortOrder?: number;
  isEnabled?: boolean;
}
export interface CategoryPatch {
  name?: string;
  slug?: string;
  sortOrder?: number;
  isEnabled?: boolean;
}

export interface FilterRecord {
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
  /** Serialized ParsedPictureControl JSON text (owned by @easypic/ncp-parser). */
  parsedJson: string;
  createdAt: string;
  updatedAt: string;
}
export interface FilterWithCategory extends FilterRecord {
  category: CategoryRecord;
}
export interface NewFilter {
  displayName: string;
  sourceName: string;
  description?: string;
  categoryId: string;
  slug?: string;
  sortOrder?: number;
  isEnabled?: boolean;
  ncpBlob: Uint8Array;
  ncpSha256: string;
  parserVersion: number;
  parsedJson: string;
}
export interface FilterPatch {
  displayName?: string;
  description?: string;
  categoryId?: string;
  slug?: string;
  sortOrder?: number;
  isEnabled?: boolean;
}

export interface AdminRecord {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  passwordChangedAt: string;
}

export interface AdminSessionRecord {
  id: string;
  adminId: string;
  tokenHash: string;
  csrfSecret: string;
  expiresAt: string;
  createdAt: string;
  lastSeenAt: string;
}
