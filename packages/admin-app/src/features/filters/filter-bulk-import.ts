import {
  NcpInspectionError,
  bytesToBase64,
  inspectNcpFile,
  type NcpInspection,
} from '../../lib/ncp-inspector';
import { ncpInspectionMessage } from './filter-form';

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
}

export interface BulkFilterDefaults {
  categoryId: string;
  isEnabled: boolean;
  startingSortOrder: number;
}

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
    if (seenBase64.has(row.ncpBase64)) return { ...row, status: 'duplicate' };
    seenBase64.add(row.ncpBase64);
    return row;
  });
}
