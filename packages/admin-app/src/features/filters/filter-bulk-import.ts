import {
  NcpInspectionError,
  bytesToBase64,
  inspectNcpFile,
  type NcpInspection,
} from '../../lib/ncp-inspector';
import { ApiFailure, type FilterCreateInput } from '../../lib/admin-client';
import { filterClientErrors, mapFilterCreateError, ncpInspectionMessage } from './filter-form';

export const MAX_BULK_FILTER_FILES = 100;

export type BulkFilterStatus = 'ready' | 'invalid' | 'importing' | 'success' | 'failed' | 'duplicate';

export interface BulkFilterRow {
  id: string;
  fileName: string;
  inspection: NcpInspection | null;
  ncpBase64: string | null;
  displayName: string;
  categoryId: string;
  sortOrder: string;
  isEnabled: boolean;
  categoryOverridden: boolean;
  enabledOverridden: boolean;
  status: BulkFilterStatus;
  message: string | null;
  retryable: boolean;
}

export interface BulkFilterDefaults {
  categoryId: string;
  isEnabled: boolean;
  startingSortOrder: number;
}

export interface BulkFilterRowUpdate {
  status: BulkFilterStatus;
  message: string | null;
  retryable: boolean;
}

export interface BulkImportRunResult {
  createdCount: number;
  failedCount: number;
  paused: boolean;
}

export type BulkFilterCreate = (input: FilterCreateInput) => Promise<unknown>;
export type BulkFilterRowUpdater = (id: string, update: BulkFilterRowUpdate) => void;

function invalidRow(file: File, index: number, defaults: BulkFilterDefaults, error: unknown): BulkFilterRow {
  return {
    id: `bulk-filter-${index}`,
    fileName: file.name,
    inspection: null,
    ncpBase64: null,
    displayName: '',
    categoryId: defaults.categoryId,
    sortOrder: String(defaults.startingSortOrder + index),
    isEnabled: defaults.isEnabled,
    categoryOverridden: false,
    enabledOverridden: false,
    status: 'invalid',
    message: error instanceof NcpInspectionError
      ? ncpInspectionMessage(error)
      : 'NCP 文件已损坏或格式无效',
    retryable: false,
  };
}

async function inspectBulkFilterFile(
  file: File,
  index: number,
  defaults: BulkFilterDefaults,
): Promise<BulkFilterRow> {
  try {
    const inspection = await inspectNcpFile(file);
    return {
      id: `bulk-filter-${index}`,
      fileName: file.name,
      inspection,
      ncpBase64: bytesToBase64(inspection.bytes),
      displayName: inspection.parsed.sourceName,
      categoryId: defaults.categoryId,
      sortOrder: String(defaults.startingSortOrder + index),
      isEnabled: defaults.isEnabled,
      categoryOverridden: false,
      enabledOverridden: false,
      status: 'ready',
      message: null,
      retryable: true,
    };
  } catch (error) {
    return invalidRow(file, index, defaults, error);
  }
}

export async function inspectBulkFilterFiles(
  files: readonly File[],
  defaults: BulkFilterDefaults,
): Promise<BulkFilterRow[]> {
  if (files.length > MAX_BULK_FILTER_FILES) {
    throw new Error(`一次最多选择 ${MAX_BULK_FILTER_FILES} 个 NCP 文件`);
  }

  const rows = await Promise.all(
    files.map((file, index) => inspectBulkFilterFile(file, index, defaults)),
  );
  const seenBase64 = new Set<string>();

  return rows.map((row) => {
    if (row.status !== 'ready' || row.ncpBase64 === null) return row;
    if (seenBase64.has(row.ncpBase64)) return { ...row, status: 'duplicate', retryable: false };
    seenBase64.add(row.ncpBase64);
    return row;
  });
}

export function toFilterCreateInput(row: BulkFilterRow): FilterCreateInput | null {
  if (!row.ncpBase64) return null;

  const errors = filterClientErrors({
    displayName: row.displayName,
    categoryId: row.categoryId,
    description: '',
    slug: '',
    sortOrder: row.sortOrder,
  });
  if (Object.keys(errors).length > 0) return null;

  return {
    ncpBase64: row.ncpBase64,
    displayName: row.displayName.trim(),
    categoryId: row.categoryId,
    sortOrder: Number(row.sortOrder),
    isEnabled: row.isEnabled,
  };
}

export async function runBulkFilterImport(
  rows: readonly BulkFilterRow[],
  create: BulkFilterCreate,
  onRow: BulkFilterRowUpdater,
): Promise<BulkImportRunResult> {
  let createdCount = 0;
  let failedCount = 0;

  for (const row of rows) {
    if (row.status !== 'ready' && !(row.status === 'failed' && row.retryable)) continue;
    const input = toFilterCreateInput(row);
    if (input === null) continue;

    onRow(row.id, { status: 'importing', message: null, retryable: false });
    let failure: { error: unknown } | null = null;
    try {
      await create(input);
    } catch (error) {
      failure = { error };
    }

    if (failure === null) {
      createdCount += 1;
      onRow(row.id, { status: 'success', message: '已导入', retryable: false });
      continue;
    }

    failedCount += 1;
    const { error } = failure;
    const mapped = mapFilterCreateError(error);
    const duplicate = error instanceof ApiFailure && error.code === 'DUPLICATE_NCP';
    onRow(row.id, {
      status: duplicate ? 'duplicate' : 'failed',
      message: error instanceof ApiFailure && error.code === 'SLUG_CONFLICT'
        ? '请修改显示名称，或使用单个新增流程自定义 Slug'
        : mapped.summary ?? Object.values(mapped.fields)[0] ?? '导入失败，请重试',
      retryable: duplicate ? false : mapped.retryable,
    });
    if (error instanceof ApiFailure && error.status === 0) {
      return { createdCount, failedCount, paused: true };
    }
  }

  return { createdCount, failedCount, paused: false };
}
