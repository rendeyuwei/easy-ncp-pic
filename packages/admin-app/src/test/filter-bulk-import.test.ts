import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_BULK_FILTER_FILES,
  inspectBulkFilterFiles,
} from '../features/filters/filter-bulk-import';

const here = dirname(fileURLToPath(import.meta.url));
const fixture02 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON02.NCP')),
);
const fixture33 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON33.NCP')),
);

function fixtureFile(bytes: Uint8Array<ArrayBuffer>, name: string): File {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.slice().buffer,
  });
  return file;
}

const defaults = {
  categoryId: 'film',
  isEnabled: true,
  startingSortOrder: 21,
};

describe('inspectBulkFilterFiles', () => {
  it('keeps input order and inherits the batch defaults for valid NCP fixtures', async () => {
    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'a.NCP'),
      fixtureFile(fixture33, 'b.NCP'),
    ], defaults);

    expect(rows.map((row) => [row.displayName, row.categoryId, row.sortOrder])).toEqual([
      ['Fuji Astia', 'film', '21'],
      ['SHING TokugawaTone2', 'film', '22'],
    ]);
    expect(rows.map((row) => row.isEnabled)).toEqual([true, true]);
    expect(rows.map((row) => row.status)).toEqual(['ready', 'ready']);
    expect(rows.map((row) => row.categoryOverridden)).toEqual([false, false]);
    expect(rows.map((row) => row.enabledOverridden)).toEqual([false, false]);
  });

  it('keeps invalid files visible without upload bytes while preserving input order', async () => {
    const damaged = fixture02.slice();
    damaged[0] = 0;

    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'first.NCP'),
      fixtureFile(damaged, 'damaged.NCP'),
      fixtureFile(fixture33, 'last.NCP'),
    ], defaults);

    expect(rows.map((row) => [row.fileName, row.status, row.message])).toEqual([
      ['first.NCP', 'ready', null],
      ['damaged.NCP', 'invalid', 'NCP 文件已损坏或格式无效'],
      ['last.NCP', 'ready', null],
    ]);
    expect(rows[1]?.inspection).toBeNull();
    expect(rows[1]?.ncpBase64).toBeNull();
  });

  it('marks only later byte-identical files as duplicates', async () => {
    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'one.NCP'),
      fixtureFile(fixture02, 'two.NCP'),
    ], defaults);

    expect(rows.map((row) => [row.fileName, row.status, row.ncpBase64 === null])).toEqual([
      ['one.NCP', 'ready', false],
      ['two.NCP', 'duplicate', false],
    ]);
  });

  it('assigns deterministic unique IDs that do not depend on duplicate file names', async () => {
    const rows = await inspectBulkFilterFiles([
      fixtureFile(fixture02, 'same.NCP'),
      fixtureFile(fixture33, 'same.NCP'),
    ], defaults);

    expect(rows.map((row) => row.id)).toEqual(['bulk-filter-0', 'bulk-filter-1']);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('accepts exactly 100 files', async () => {
    const rows = await inspectBulkFilterFiles(
      Array.from({ length: MAX_BULK_FILTER_FILES }, (_, index) => fixtureFile(fixture02, `${index}.NCP`)),
      defaults,
    );

    expect(rows).toHaveLength(MAX_BULK_FILTER_FILES);
    expect(rows.at(-1)?.sortOrder).toBe('120');
  });

  it('rejects 101 files before reading any bytes', async () => {
    const arrayBuffer = vi.fn(async () => fixture02.slice().buffer);
    const guardedFile = { name: 'guarded.NCP', size: fixture02.length, arrayBuffer } as unknown as File;
    const files = Array.from({ length: MAX_BULK_FILTER_FILES + 1 }, () => guardedFile);

    await expect(inspectBulkFilterFiles(files, defaults)).rejects.toThrow('一次最多选择 100 个 NCP 文件');

    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
