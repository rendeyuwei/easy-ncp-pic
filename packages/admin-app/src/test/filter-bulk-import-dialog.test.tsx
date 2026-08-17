import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FilterBulkImportDialog,
  type FilterBulkImportDialogProps,
} from '../features/filters/filter-bulk-import-dialog';
import type {
  BulkFilterRow,
  BulkFilterRowUpdater,
  BulkImportRunResult,
} from '../features/filters/filter-bulk-import';
import { useBulkCreateFilters } from '../features/filters/filter-queries';
import type { AdminCategory, AdminFilter } from '../lib/api-schema';
import { categoryFixture, filterFixture } from './fixtures';

vi.mock('../features/filters/filter-queries', () => ({
  useBulkCreateFilters: vi.fn(),
}));

const here = dirname(fileURLToPath(import.meta.url));
const fixture02 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON02.NCP')),
);
const fixture33 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON33.NCP')),
);
const fixtureVariant = fixture02.slice();
fixtureVariant[0x10] = 0x43;

function ncpFile(bytes: Uint8Array<ArrayBuffer>, name: string): File {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.slice().buffer,
  });
  return file;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => {
      resolve = next;
      reject = fail;
    }),
    resolve,
    reject,
  };
}

const monochromeCategory: AdminCategory = {
  id: 'category-monochrome',
  name: '黑白',
  slug: 'monochrome',
  sortOrder: 20,
  isEnabled: true,
};

const replacementCategory: AdminCategory = {
  id: 'category-replacement',
  name: '替代分类',
  slug: 'replacement',
  sortOrder: 30,
  isEnabled: true,
};

const categories = [categoryFixture, monochromeCategory];
const filters: AdminFilter[] = [
  { ...filterFixture, id: 'film-low', sortOrder: 4 },
  { ...filterFixture, id: 'film-high', sortOrder: 20 },
  {
    ...filterFixture,
    id: 'mono-high',
    categoryId: monochromeCategory.id,
    sortOrder: 40,
  },
];

type Runner = ReturnType<typeof useBulkCreateFilters>['run'];

const useBulkCreateFiltersMock = vi.mocked(useBulkCreateFilters);

function completedResult(): BulkImportRunResult {
  return { createdCount: 0, failedCount: 0, paused: false };
}

function renderDialog(overrides: Partial<FilterBulkImportDialogProps> = {}) {
  const props: FilterBulkImportDialogProps = {
    open: true,
    categories,
    filters,
    onOpenChange: vi.fn(),
    onImported: vi.fn(),
    ...overrides,
  };
  const view = render(<FilterBulkImportDialog {...props} />);
  return { ...view, props, user: userEvent.setup() };
}

function rowLabel(fileName: string, field: string, presentation: '桌面' | '移动' = '桌面') {
  return `${fileName} ${field}（${presentation}）`;
}

beforeEach(() => {
  useBulkCreateFiltersMock.mockReturnValue({
    run: vi.fn(async () => completedResult()),
    isPending: false,
  });
});

describe('FilterBulkImportDialog defaults and responsive rows', () => {
  it('inherits first-category defaults, keeps visible sort values stable, and preserves row overrides', async () => {
    const { user } = renderDialog();

    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'astia.NCP'),
      ncpFile(fixture33, 'mono.NCP'),
    ]);

    expect(await screen.findByLabelText(rowLabel('astia.NCP', '显示名称'))).toHaveValue('Fuji Astia');
    expect(screen.getByLabelText(rowLabel('mono.NCP', '显示名称'))).toHaveValue('SHING TokugawaTone2');
    expect(screen.getByLabelText(rowLabel('astia.NCP', '分类'))).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('mono.NCP', '分类'))).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('astia.NCP', '排序'))).toHaveValue(21);
    expect(screen.getByLabelText(rowLabel('mono.NCP', '排序'))).toHaveValue(22);
    expect(screen.getByLabelText(rowLabel('astia.NCP', '启用'))).toBeChecked();
    expect(screen.getByLabelText(rowLabel('mono.NCP', '启用'))).toBeChecked();

    await user.selectOptions(screen.getByLabelText('默认分类'), monochromeCategory.id);
    expect(screen.getByLabelText(rowLabel('astia.NCP', '分类'))).toHaveValue(monochromeCategory.id);
    expect(screen.getByLabelText(rowLabel('mono.NCP', '分类'))).toHaveValue(monochromeCategory.id);
    expect(screen.getByLabelText(rowLabel('astia.NCP', '排序'))).toHaveValue(21);
    expect(screen.getByLabelText(rowLabel('mono.NCP', '排序'))).toHaveValue(22);

    await user.selectOptions(screen.getByLabelText(rowLabel('astia.NCP', '分类')), categoryFixture.id);
    await user.selectOptions(screen.getByLabelText('默认分类'), categoryFixture.id);
    await user.selectOptions(screen.getByLabelText('默认分类'), monochromeCategory.id);
    expect(screen.getByLabelText(rowLabel('astia.NCP', '分类'))).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('mono.NCP', '分类'))).toHaveValue(monochromeCategory.id);

    await user.click(screen.getByLabelText('默认启用状态'));
    expect(screen.getByLabelText(rowLabel('astia.NCP', '启用'))).not.toBeChecked();
    expect(screen.getByLabelText(rowLabel('mono.NCP', '启用'))).not.toBeChecked();
    await user.click(screen.getByLabelText(rowLabel('astia.NCP', '启用')));
    await user.click(screen.getByLabelText('默认启用状态'));
    await user.click(screen.getByLabelText('默认启用状态'));
    expect(screen.getByLabelText(rowLabel('astia.NCP', '启用'))).toBeChecked();
    expect(screen.getByLabelText(rowLabel('mono.NCP', '启用'))).not.toBeChecked();

    const firstName = screen.getByLabelText(rowLabel('astia.NCP', '显示名称'));
    const secondName = screen.getByLabelText(rowLabel('mono.NCP', '显示名称'));
    const firstOrder = screen.getByLabelText(rowLabel('astia.NCP', '排序'));
    const secondOrder = screen.getByLabelText(rowLabel('mono.NCP', '排序'));
    await user.clear(firstName);
    await user.type(firstName, 'Astia Edited');
    await user.clear(secondName);
    await user.type(secondName, 'Mono Edited');
    await user.clear(firstOrder);
    await user.type(firstOrder, '71');
    await user.clear(secondOrder);
    await user.type(secondOrder, '72');

    expect(screen.getByLabelText(rowLabel('astia.NCP', '显示名称', '移动'))).toHaveValue('Astia Edited');
    expect(screen.getByLabelText(rowLabel('mono.NCP', '显示名称', '移动'))).toHaveValue('Mono Edited');
    expect(screen.getByLabelText(rowLabel('astia.NCP', '排序', '移动'))).toHaveValue(71);
    expect(screen.getByLabelText(rowLabel('mono.NCP', '排序', '移动'))).toHaveValue(72);
    expect(document.querySelector('.bulk-import-table')).toBeInTheDocument();
    expect(document.querySelector('.bulk-import-cards')).toBeInTheDocument();
  });

  it('uses the selected default category maximum for a replacement selection', async () => {
    const { user } = renderDialog();

    await user.selectOptions(screen.getByLabelText('默认分类'), monochromeCategory.id);
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'one.NCP'),
      ncpFile(fixture33, 'two.NCP'),
    ]);

    expect(await screen.findByLabelText(rowLabel('one.NCP', '排序'))).toHaveValue(41);
    expect(screen.getByLabelText(rowLabel('two.NCP', '排序'))).toHaveValue(42);
  });

  it('shares mobile actions with the table state', async () => {
    const { user } = renderDialog();
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'keep.NCP'),
      ncpFile(fixture33, 'remove.NCP'),
    ]);
    await screen.findByLabelText(rowLabel('remove.NCP', '显示名称'));

    await user.click(screen.getByRole('button', { name: rowLabel('remove.NCP', '移除', '移动') }));

    expect(screen.queryByLabelText(rowLabel('remove.NCP', '显示名称'))).not.toBeInTheDocument();
    expect(screen.queryByLabelText(rowLabel('remove.NCP', '显示名称', '移动'))).not.toBeInTheDocument();
    expect(screen.getByLabelText(rowLabel('keep.NCP', '显示名称'))).toBeInTheDocument();
  });
});

describe('FilterBulkImportDialog inspection lifecycle', () => {
  it('preserves state when a controlled close is declined and resets only after an actual close transition', async () => {
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    const user = userEvent.setup();
    const baseProps: FilterBulkImportDialogProps = {
      open: true,
      categories,
      filters,
      onOpenChange,
      onImported,
    };
    const { rerender } = render(<FilterBulkImportDialog {...baseProps} />);
    const input = screen.getByLabelText('NCP 文件（可多选）');
    await user.upload(input, ncpFile(fixture02, 'held-open.NCP'));
    const name = await screen.findByLabelText(rowLabel('held-open.NCP', '显示名称'));
    await user.clear(name);
    await user.type(name, 'Held Open');
    await user.selectOptions(screen.getByLabelText('默认分类'), monochromeCategory.id);

    await user.click(screen.getByRole('button', { name: '取消' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('dialog', { name: '批量导入滤镜' })).toBeInTheDocument();
    expect(screen.getByLabelText(rowLabel('held-open.NCP', '显示名称'))).toHaveValue('Held Open');
    expect(screen.getByLabelText('默认分类')).toHaveValue(monochromeCategory.id);
    expect((screen.getByLabelText('NCP 文件（可多选）') as HTMLInputElement).files?.[0]?.name)
      .toBe('held-open.NCP');
    expect(screen.getByRole('status')).toHaveTextContent(/0\s*\/\s*1/);

    const slowRead = deferred<ArrayBuffer>();
    const slow = new File([fixture33], 'accepted-close.NCP', { type: 'application/octet-stream' });
    Object.defineProperty(slow, 'arrayBuffer', { value: () => slowRead.promise });
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), slow);
    rerender(<FilterBulkImportDialog {...baseProps} open={false} />);
    expect(screen.queryByRole('dialog', { name: '批量导入滤镜' })).not.toBeInTheDocument();
    rerender(<FilterBulkImportDialog {...baseProps} open />);

    expect(screen.getByLabelText('NCP 文件（可多选）')).toHaveValue('');
    expect(screen.getByLabelText('默认分类')).toHaveValue(categoryFixture.id);
    expect(screen.queryByLabelText(rowLabel('held-open.NCP', '显示名称'))).not.toBeInTheDocument();
    await act(async () => {
      slowRead.resolve(fixture33.slice().buffer);
      await slowRead.promise;
    });
    expect(screen.queryByLabelText(rowLabel('accepted-close.NCP', '显示名称'))).not.toBeInTheDocument();
  });

  it('applies the latest defaults and category sort range when they change during inspection', async () => {
    const slowRead = deferred<ArrayBuffer>();
    const slow = new File([fixture02], 'slow-defaults.NCP', { type: 'application/octet-stream' });
    Object.defineProperty(slow, 'arrayBuffer', { value: () => slowRead.promise });
    const { user } = renderDialog();

    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), slow);
    await user.selectOptions(screen.getByLabelText('默认分类'), monochromeCategory.id);
    await user.click(screen.getByLabelText('默认启用状态'));
    await act(async () => {
      slowRead.resolve(fixture02.slice().buffer);
      await slowRead.promise;
    });

    expect(await screen.findByLabelText(rowLabel('slow-defaults.NCP', '分类')))
      .toHaveValue(monochromeCategory.id);
    expect(screen.getByLabelText(rowLabel('slow-defaults.NCP', '排序'))).toHaveValue(41);
    expect(screen.getByLabelText(rowLabel('slow-defaults.NCP', '启用'))).not.toBeChecked();
  });

  it('uses the first category when categories arrive before an in-flight inspection finishes', async () => {
    const slowRead = deferred<ArrayBuffer>();
    const slow = new File([fixture02], 'late-category.NCP', { type: 'application/octet-stream' });
    Object.defineProperty(slow, 'arrayBuffer', { value: () => slowRead.promise });
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBulkImportDialog
        open
        categories={[]}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );

    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), slow);
    rerender(
      <FilterBulkImportDialog
        open
        categories={categories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );
    await act(async () => {
      slowRead.resolve(fixture02.slice().buffer);
      await slowRead.promise;
    });

    expect(await screen.findByLabelText(rowLabel('late-category.NCP', '分类')))
      .toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('late-category.NCP', '排序'))).toHaveValue(21);
  });

  it('inherits the first category without rewriting a visible sort when categories arrive later', async () => {
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBulkImportDialog
        open
        categories={[]}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );
    await user.upload(
      screen.getByLabelText('NCP 文件（可多选）'),
      ncpFile(fixture02, 'visible-before-category.NCP'),
    );
    expect(await screen.findByLabelText(rowLabel('visible-before-category.NCP', '分类'))).toHaveValue('');
    expect(screen.getByLabelText(rowLabel('visible-before-category.NCP', '排序'))).toHaveValue(1);

    rerender(
      <FilterBulkImportDialog
        open
        categories={categories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );

    expect(await screen.findByLabelText(rowLabel('visible-before-category.NCP', '分类')))
      .toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('visible-before-category.NCP', '排序'))).toHaveValue(1);
  });

  it('reconciles a replaced default while locking success and invalidating a missing override', async () => {
    let invocation = 0;
    const run: Runner = vi.fn(async (
      rows: readonly BulkFilterRow[],
      onRow: BulkFilterRowUpdater,
    ) => {
      invocation += 1;
      if (invocation === 1) {
        onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
        return { createdCount: 1, failedCount: 0, paused: false };
      }
      expect(rows.map((row) => row.fileName)).toEqual(['inherited.NCP']);
      onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
      return { createdCount: 1, failedCount: 0, paused: false };
    });
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBulkImportDialog
        open
        categories={categories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'locked.NCP'),
      ncpFile(fixture33, 'inherited.NCP'),
      ncpFile(fixtureVariant, 'overridden.NCP'),
    ]);
    await screen.findByLabelText(rowLabel('overridden.NCP', '分类'));
    await user.selectOptions(
      screen.getByLabelText(rowLabel('overridden.NCP', '分类')),
      monochromeCategory.id,
    );
    await user.click(screen.getByRole('button', { name: '导入可用项' }));

    rerender(
      <FilterBulkImportDialog
        open
        categories={[replacementCategory]}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );

    expect(screen.getByLabelText('默认分类')).toHaveValue(replacementCategory.id);
    expect(screen.getByLabelText(rowLabel('locked.NCP', '分类'))).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('locked.NCP', '分类'))).toBeDisabled();
    expect(screen.getByLabelText(rowLabel('inherited.NCP', '分类'))).toHaveValue(replacementCategory.id);
    expect(screen.getByLabelText(rowLabel('inherited.NCP', '排序'))).toHaveValue(22);
    expect(screen.getByLabelText(rowLabel('overridden.NCP', '分类'))).toHaveValue('');
    expect(screen.getByLabelText(rowLabel('overridden.NCP', '分类')))
      .toHaveAccessibleDescription('原分类已不可用，请重新选择分类');
    expect(screen.getByLabelText(rowLabel('overridden.NCP', '排序'))).toHaveValue(23);

    await user.click(screen.getByRole('button', { name: '继续导入' }));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('makes rows ineligible when categories empty and restores only inherited rows on reappearance', async () => {
    const run = vi.fn(async () => completedResult());
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBulkImportDialog
        open
        categories={categories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'empty-inherited.NCP'),
      ncpFile(fixture33, 'empty-overridden.NCP'),
    ]);
    await screen.findByLabelText(rowLabel('empty-overridden.NCP', '分类'));
    await user.selectOptions(
      screen.getByLabelText(rowLabel('empty-overridden.NCP', '分类')),
      monochromeCategory.id,
    );

    rerender(
      <FilterBulkImportDialog
        open
        categories={[]}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );

    expect(screen.getByLabelText('默认分类')).toHaveValue('');
    expect(screen.getByLabelText(rowLabel('empty-inherited.NCP', '分类'))).toHaveValue('');
    expect(screen.getByLabelText(rowLabel('empty-overridden.NCP', '分类'))).toHaveValue('');
    expect(screen.getByLabelText(rowLabel('empty-inherited.NCP', '分类'))).toHaveAccessibleDescription('请选择分类');
    expect(screen.getByLabelText(rowLabel('empty-overridden.NCP', '分类')))
      .toHaveAccessibleDescription('原分类已不可用，请重新选择分类');
    expect(screen.getByRole('button', { name: '导入可用项' })).toBeDisabled();
    expect(screen.getByText(/其中 0 个当前可导入/)).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();

    rerender(
      <FilterBulkImportDialog
        open
        categories={categories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );

    expect(screen.getByLabelText('默认分类')).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('empty-inherited.NCP', '分类'))).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('empty-inherited.NCP', '排序'))).toHaveValue(21);
    expect(screen.getByLabelText(rowLabel('empty-overridden.NCP', '分类'))).toHaveValue('');
    expect(screen.getByLabelText(rowLabel('empty-overridden.NCP', '排序'))).toHaveValue(22);
  });

  it.each([
    ['replacement', [replacementCategory], replacementCategory.id],
    ['removal', [], ''],
  ])('reconciles category %s before held inspection materializes', async (_kind, nextCategories, expectedCategoryId) => {
    const slowRead = deferred<ArrayBuffer>();
    const slow = new File([fixture02], 'held-category.NCP', { type: 'application/octet-stream' });
    Object.defineProperty(slow, 'arrayBuffer', { value: () => slowRead.promise });
    const onOpenChange = vi.fn();
    const onImported = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBulkImportDialog
        open
        categories={categories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), slow);

    rerender(
      <FilterBulkImportDialog
        open
        categories={nextCategories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={onImported}
      />,
    );
    await act(async () => {
      slowRead.resolve(fixture02.slice().buffer);
      await slowRead.promise;
    });

    expect(await screen.findByLabelText(rowLabel('held-category.NCP', '分类')))
      .toHaveValue(expectedCategoryId);
    expect(screen.getByLabelText(rowLabel('held-category.NCP', '排序'))).toHaveValue(1);
    if (!expectedCategoryId) {
      expect(screen.getByRole('button', { name: '导入可用项' })).toBeDisabled();
    }
  });

  it('ignores an older multi-file inspection that resolves after a replacement', async () => {
    const slowRead = deferred<ArrayBuffer>();
    const slow = new File([fixture02], 'slow.NCP', { type: 'application/octet-stream' });
    Object.defineProperty(slow, 'arrayBuffer', { value: () => slowRead.promise });
    const { user } = renderDialog();
    const input = screen.getByLabelText('NCP 文件（可多选）');

    await user.upload(input, slow);
    await user.upload(input, ncpFile(fixture33, 'latest.NCP'));
    expect(await screen.findByLabelText(rowLabel('latest.NCP', '显示名称'))).toHaveValue('SHING TokugawaTone2');

    await act(async () => {
      slowRead.resolve(fixture02.slice().buffer);
      await slowRead.promise;
    });
    expect(screen.queryByLabelText(rowLabel('slow.NCP', '显示名称'))).not.toBeInTheDocument();
    expect(screen.getByLabelText(rowLabel('latest.NCP', '显示名称'))).toBeInTheDocument();
  });

  it('invalidates inspection and resets defaults and rows across close and reopen', async () => {
    const slowRead = deferred<ArrayBuffer>();
    const slow = new File([fixture02], 'stale.NCP', { type: 'application/octet-stream' });
    Object.defineProperty(slow, 'arrayBuffer', { value: () => slowRead.promise });
    const onOpenChange = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>重新打开</button>
          <FilterBulkImportDialog
            open={open}
            categories={categories}
            filters={filters}
            onOpenChange={(next) => {
              onOpenChange(next);
              setOpen(next);
            }}
            onImported={vi.fn()}
          />
        </>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    await user.selectOptions(screen.getByLabelText('默认分类'), monochromeCategory.id);
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), slow);
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '批量导入滤镜' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重新打开' }));

    expect(screen.getByLabelText('默认分类')).toHaveValue(categoryFixture.id);
    expect(screen.queryByLabelText(rowLabel('stale.NCP', '显示名称'))).not.toBeInTheDocument();
    await act(async () => {
      slowRead.resolve(fixture02.slice().buffer);
      await slowRead.promise;
    });
    expect(screen.queryByLabelText(rowLabel('stale.NCP', '显示名称'))).not.toBeInTheDocument();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('FilterBulkImportDialog validation and import runs', () => {
  it('reports row validation through each invalid control and does not call the runner', async () => {
    const run = vi.fn(async () => completedResult());
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const { user } = renderDialog();
    await user.upload(
      screen.getByLabelText('NCP 文件（可多选）'),
      ncpFile(fixture02, 'invalid-fields.NCP'),
    );
    const name = await screen.findByLabelText(rowLabel('invalid-fields.NCP', '显示名称'));
    const order = screen.getByLabelText(rowLabel('invalid-fields.NCP', '排序'));
    await user.clear(name);
    await user.clear(order);
    await user.type(order, '1.5');
    await user.click(screen.getByRole('button', { name: '导入可用项' }));

    expect(name).toHaveAccessibleDescription('请输入显示名称');
    expect(order).toHaveAccessibleDescription('排序必须是整数');
    expect(screen.getByLabelText(rowLabel('invalid-fields.NCP', '显示名称', '移动')))
      .toHaveAccessibleDescription('请输入显示名称');
    expect(run).not.toHaveBeenCalled();
  });

  it('merges callback retryability, locks successes, and retries only the failed row', async () => {
    const onImported = vi.fn();
    let invocation = 0;
    const run = vi.fn(async (
      rows: readonly BulkFilterRow[],
      onRow: BulkFilterRowUpdater,
    ): Promise<BulkImportRunResult> => {
      invocation += 1;
      if (invocation === 1) {
        expect(rows.map((row) => row.fileName)).toEqual(['a.NCP', 'b.NCP', 'c.NCP']);
        onRow(rows[0]!.id, { status: 'importing', message: null, retryable: false });
        onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
        onRow(rows[1]!.id, { status: 'importing', message: null, retryable: false });
        onRow(rows[1]!.id, { status: 'duplicate', message: '该 NCP 已存在', retryable: false });
        onRow(rows[2]!.id, { status: 'importing', message: null, retryable: false });
        onRow(rows[2]!.id, { status: 'failed', message: '服务暂时不可用', retryable: true });
        return { createdCount: 1, failedCount: 2, paused: false };
      }

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ fileName: 'c.NCP', status: 'failed', retryable: true });
      onRow(rows[0]!.id, { status: 'importing', message: null, retryable: false });
      onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
      return { createdCount: 1, failedCount: 0, paused: false };
    });
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const { user } = renderDialog({ onImported });
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'a.NCP'),
      ncpFile(fixture33, 'b.NCP'),
      ncpFile(fixtureVariant, 'c.NCP'),
    ]);
    const retryName = await screen.findByLabelText(rowLabel('c.NCP', '显示名称'));
    const retryOrder = screen.getByLabelText(rowLabel('c.NCP', '排序'));
    await user.clear(retryName);
    await user.type(retryName, 'Keep Me');
    await user.clear(retryOrder);
    await user.type(retryOrder, '91');

    await user.click(screen.getByRole('button', { name: '导入可用项' }));

    expect(screen.getByLabelText(rowLabel('a.NCP', '显示名称'))).toBeDisabled();
    expect(screen.getByLabelText(rowLabel('a.NCP', '分类', '移动'))).toBeDisabled();
    expect(screen.getByRole('button', { name: rowLabel('a.NCP', '移除') })).toBeDisabled();
    expect(screen.getAllByText('已存在').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: rowLabel('b.NCP', '重试') })).not.toBeInTheDocument();
    expect(screen.getByLabelText(rowLabel('c.NCP', '显示名称'))).toHaveValue('Keep Me');
    expect(screen.getByLabelText(rowLabel('c.NCP', '排序'))).toHaveValue(91);
    expect(screen.getByRole('button', { name: rowLabel('c.NCP', '重试') })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent(/3\s*\/\s*3/);
    expect(onImported).toHaveBeenLastCalledWith({ createdCount: 1, failedCount: 2, paused: false });

    await user.click(screen.getByRole('button', { name: rowLabel('c.NCP', '重试') }));

    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(rowLabel('c.NCP', '显示名称'))).toHaveValue('Keep Me');
    expect(screen.getByLabelText(rowLabel('c.NCP', '显示名称'))).toBeDisabled();
    expect(screen.getAllByText('已导入').length).toBeGreaterThan(0);
    expect(screen.getAllByText('已存在').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent(/1\s*\/\s*1/);

    await user.selectOptions(screen.getByLabelText('默认分类'), monochromeCategory.id);
    await user.click(screen.getByLabelText('默认启用状态'));
    expect(screen.getByLabelText(rowLabel('a.NCP', '分类'))).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('c.NCP', '分类'))).toHaveValue(categoryFixture.id);
    expect(screen.getByLabelText(rowLabel('a.NCP', '启用'))).toBeChecked();
    expect(screen.getByLabelText(rowLabel('c.NCP', '启用'))).toBeChecked();
    expect(screen.getByLabelText(rowLabel('b.NCP', '分类'))).toHaveValue(monochromeCategory.id);
    expect(screen.getByLabelText(rowLabel('b.NCP', '启用'))).not.toBeChecked();
  });

  it('preserves the completed outcome when the import callback throws', async () => {
    const result = { createdCount: 1, failedCount: 0, paused: false } as const;
    const run: Runner = vi.fn(async (
      rows: readonly BulkFilterRow[],
      onRow: BulkFilterRowUpdater,
    ) => {
      onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
      return result;
    });
    const onImported = vi.fn(() => {
      throw new Error('consumer failed');
    });
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const { user } = renderDialog({ onImported });
    await user.upload(
      screen.getByLabelText('NCP 文件（可多选）'),
      ncpFile(fixture02, 'completed.NCP'),
    );
    const name = await screen.findByLabelText(rowLabel('completed.NCP', '显示名称'));

    await user.click(screen.getByRole('button', { name: '导入可用项' }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(onImported).toHaveBeenCalledWith(result);
    expect(name).toBeDisabled();
    expect(screen.getByText('已导入 1 个滤镜，0 个需要处理')).toBeInTheDocument();
    expect(screen.queryByText('批量导入未完成，请重试')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续导入' })).toBeDisabled();
  });

  it('observes a deferred import callback rejection without changing the completed outcome', async () => {
    const callbackResult = deferred<void>();
    const result = { createdCount: 1, failedCount: 0, paused: false } as const;
    const importedResults: BulkImportRunResult[] = [];
    const run: Runner = vi.fn(async (
      rows: readonly BulkFilterRow[],
      onRow: BulkFilterRowUpdater,
    ) => {
      onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
      return result;
    });
    const onImported: FilterBulkImportDialogProps['onImported'] = async (importedResult) => {
      importedResults.push(importedResult);
      await callbackResult.promise;
    };
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const { user } = renderDialog({ onImported });
    await user.upload(
      screen.getByLabelText('NCP 文件（可多选）'),
      ncpFile(fixture02, 'async-completed.NCP'),
    );
    const name = await screen.findByLabelText(rowLabel('async-completed.NCP', '显示名称'));

    await user.click(screen.getByRole('button', { name: '导入可用项' }));

    expect(importedResults).toEqual([result]);
    expect(name).toBeDisabled();
    expect(screen.getByText('已导入 1 个滤镜，0 个需要处理')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      callbackResult.reject(new Error('async consumer failed'));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    expect(name).toBeDisabled();
    expect(screen.getByText('已导入 1 个滤镜，0 个需要处理')).toBeInTheDocument();
    expect(screen.queryByText('批量导入未完成，请重试')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续导入' })).toBeDisabled();
  });

  it.each([
    ['显示名称', async (user: ReturnType<typeof userEvent.setup>, fileName: string) => {
      const input = screen.getByLabelText(rowLabel(fileName, '显示名称'));
      await user.clear(input);
      await user.type(input, 'Recovered Name');
    }],
    ['分类', async (user: ReturnType<typeof userEvent.setup>, fileName: string) => {
      await user.selectOptions(
        screen.getByLabelText(rowLabel(fileName, '分类')),
        monochromeCategory.id,
      );
    }],
    ['排序', async (user: ReturnType<typeof userEvent.setup>, fileName: string) => {
      const input = screen.getByLabelText(rowLabel(fileName, '排序'));
      await user.clear(input);
      await user.type(input, '88');
    }],
    ['启用状态', async (user: ReturnType<typeof userEvent.setup>, fileName: string) => {
      await user.click(screen.getByLabelText(rowLabel(fileName, '启用')));
    }],
  ])('makes a deterministic failed row retryable after editing its %s', async (_field, edit) => {
    let invocation = 0;
    const run: Runner = vi.fn(async (
      rows: readonly BulkFilterRow[],
      onRow: BulkFilterRowUpdater,
    ) => {
      invocation += 1;
      if (invocation === 1) {
        onRow(rows[0]!.id, {
          status: 'failed',
          message: '请修改后重试',
          retryable: false,
        });
        return { createdCount: 0, failedCount: 1, paused: false };
      }
      expect(rows[0]).toMatchObject({ status: 'ready', retryable: true });
      onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
      return { createdCount: 1, failedCount: 0, paused: false };
    });
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const { user } = renderDialog();
    const fileName = 'recover.NCP';
    await user.upload(
      screen.getByLabelText('NCP 文件（可多选）'),
      ncpFile(fixture02, fileName),
    );
    await screen.findByLabelText(rowLabel(fileName, '显示名称'));
    await user.click(screen.getByRole('button', { name: '导入可用项' }));
    expect(screen.queryByRole('button', { name: rowLabel(fileName, '重试') })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续导入' })).toBeDisabled();

    await edit(user, fileName);

    expect(screen.getAllByText('可导入').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '继续导入' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '继续导入' }));
    expect(run).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText(rowLabel(fileName, '显示名称'))).toBeDisabled();
  });

  it('never makes duplicate or invalid rows retryable through metadata edits', async () => {
    const damaged = fixture02.slice();
    damaged[0] = 0;
    const run: Runner = vi.fn(async (
      rows: readonly BulkFilterRow[],
      onRow: BulkFilterRowUpdater,
    ) => {
      expect(rows.map((row) => row.fileName)).toEqual(['valid.NCP']);
      onRow(rows[0]!.id, { status: 'success', message: '已导入', retryable: false });
      return { createdCount: 1, failedCount: 0, paused: false };
    });
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    const { user } = renderDialog();
    await user.upload(screen.getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'valid.NCP'),
      ncpFile(fixture02, 'duplicate.NCP'),
      ncpFile(damaged, 'invalid.NCP'),
    ]);
    await screen.findByLabelText(rowLabel('duplicate.NCP', '显示名称'));

    for (const fileName of ['duplicate.NCP', 'invalid.NCP']) {
      const name = screen.getByLabelText(rowLabel(fileName, '显示名称'));
      const order = screen.getByLabelText(rowLabel(fileName, '排序'));
      await user.clear(name);
      await user.type(name, `Edited ${fileName}`);
      await user.clear(order);
      await user.type(order, '55');
      await user.selectOptions(screen.getByLabelText(rowLabel(fileName, '分类')), monochromeCategory.id);
      await user.click(screen.getByLabelText(rowLabel(fileName, '启用')));
    }

    expect(screen.queryByRole('button', { name: rowLabel('duplicate.NCP', '重试') })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: rowLabel('invalid.NCP', '重试') })).not.toBeInTheDocument();
    expect(screen.getAllByText('已存在').length).toBeGreaterThan(0);
    expect(screen.getAllByText('文件无效').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '导入可用项' }));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('blocks closing only while the runner reports a pending request', async () => {
    const onOpenChange = vi.fn();
    const run = vi.fn(async () => completedResult());
    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: true });
    const { rerender, user } = renderDialog({ onOpenChange });

    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled());
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onOpenChange).not.toHaveBeenCalled();

    useBulkCreateFiltersMock.mockReturnValue({ run, isPending: false });
    rerender(
      <FilterBulkImportDialog
        open
        categories={categories}
        filters={filters}
        onOpenChange={onOpenChange}
        onImported={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
