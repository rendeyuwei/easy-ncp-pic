import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Field } from '../../components/ui/field';
import type { AdminCategory, AdminFilter } from '../../lib/api-schema';
import {
  inspectBulkFilterFiles,
  type BulkFilterRow,
  type BulkFilterRowUpdate,
  type BulkImportRunResult,
} from './filter-bulk-import';
import { filterClientErrors, type FilterFieldErrors } from './filter-form';
import { useBulkCreateFilters } from './filter-queries';

export interface FilterBulkImportDialogProps {
  open: boolean;
  categories: AdminCategory[];
  filters: AdminFilter[];
  filtersReady: boolean;
  onOpenChange(open: boolean): void;
  onImported(result: BulkImportRunResult): void | Promise<void>;
}

type RowErrors = Record<string, FilterFieldErrors>;
type Presentation = 'desktop' | 'mobile';
type EditableField = 'displayName' | 'categoryId' | 'sortOrder' | 'isEnabled';

interface RunProgress {
  completed: number;
  total: number;
}

const statusLabels = {
  ready: '可导入',
  invalid: '文件无效',
  importing: '导入中',
  success: '已导入',
  failed: '导入失败',
  duplicate: '已存在',
  ambiguous: '结果待核对',
  reconciling: '核对中',
} as const;

function startingSortOrder(categoryId: string, filters: readonly AdminFilter[]): number {
  const orders = filters
    .filter((filter) => filter.categoryId === categoryId)
    .map((filter) => filter.sortOrder);
  return (orders.length ? Math.max(...orders) : 0) + 1;
}

function isRunnable(row: BulkFilterRow): boolean {
  return row.status === 'ready' || (row.status === 'failed' && row.remedy === 'retry');
}

function reviveForRemedy(row: BulkFilterRow, field: EditableField): BulkFilterRow {
  return row.status === 'failed' && row.remedy === field
    ? { ...row, status: 'ready', message: null, remedy: 'none' }
    : row;
}

function presentationName(presentation: Presentation): string {
  return presentation === 'desktop' ? '桌面' : '移动';
}

function controlLabel(row: BulkFilterRow, field: string, presentation: Presentation): string {
  return `${row.fileName} ${field}（${presentationName(presentation)}）`;
}

function controlId(row: BulkFilterRow, field: string, presentation: Presentation): string {
  return `${row.id}-${field}-${presentation}`;
}

function rowIsLocked(row: BulkFilterRow, pending: boolean): boolean {
  return pending
    || row.status === 'success'
    || row.status === 'importing'
    || row.status === 'ambiguous'
    || row.status === 'reconciling';
}

function RowErrorMessage({
  id,
  error,
}: {
  id: string;
  error: string | undefined;
}) {
  return error ? <p id={id} className="field__error bulk-row-error">{error}</p> : null;
}

function RowNameControl({
  row,
  error,
  pending,
  presentation,
  onEdit,
}: {
  row: BulkFilterRow;
  error: string | undefined;
  pending: boolean;
  presentation: Presentation;
  onEdit(field: EditableField, value: string | boolean): void;
}) {
  const id = controlId(row, 'display-name', presentation);
  const errorId = `${id}-error`;
  return (
    <div className="bulk-row-control">
      <input
        id={id}
        aria-label={controlLabel(row, '显示名称', presentation)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={row.displayName}
        disabled={rowIsLocked(row, pending)}
        onChange={(event) => onEdit('displayName', event.target.value)}
      />
      <RowErrorMessage id={errorId} error={error} />
    </div>
  );
}

function RowCategoryControl({
  row,
  categories,
  error,
  pending,
  presentation,
  onEdit,
}: {
  row: BulkFilterRow;
  categories: readonly AdminCategory[];
  error: string | undefined;
  pending: boolean;
  presentation: Presentation;
  onEdit(field: EditableField, value: string | boolean): void;
}) {
  const id = controlId(row, 'category', presentation);
  const errorId = `${id}-error`;
  const categoryAvailable = categories.some((category) => category.id === row.categoryId);
  return (
    <div className="bulk-row-control">
      <select
        id={id}
        aria-label={controlLabel(row, '分类', presentation)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={row.categoryId}
        disabled={rowIsLocked(row, pending)}
        onChange={(event) => onEdit('categoryId', event.target.value)}
      >
        {!row.categoryId ? <option value="">请选择</option> : null}
        {row.categoryId && !categoryAvailable ? (
          <option value={row.categoryId}>已移除分类</option>
        ) : null}
        {categories.map((category) => (
          <option key={category.id} value={category.id}>{category.name}</option>
        ))}
      </select>
      <RowErrorMessage id={errorId} error={error} />
    </div>
  );
}

function RowOrderControl({
  row,
  error,
  pending,
  presentation,
  onEdit,
}: {
  row: BulkFilterRow;
  error: string | undefined;
  pending: boolean;
  presentation: Presentation;
  onEdit(field: EditableField, value: string | boolean): void;
}) {
  const id = controlId(row, 'sort-order', presentation);
  const errorId = `${id}-error`;
  return (
    <div className="bulk-row-control">
      <input
        id={id}
        type="number"
        step="1"
        aria-label={controlLabel(row, '排序', presentation)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        value={row.sortOrder}
        disabled={rowIsLocked(row, pending)}
        onChange={(event) => onEdit('sortOrder', event.target.value)}
      />
      <RowErrorMessage id={errorId} error={error} />
    </div>
  );
}

function RowEnabledControl({
  row,
  pending,
  presentation,
  onEdit,
}: {
  row: BulkFilterRow;
  pending: boolean;
  presentation: Presentation;
  onEdit(field: EditableField, value: string | boolean): void;
}) {
  return (
    <label className="bulk-row-checkbox">
      <input
        type="checkbox"
        aria-label={controlLabel(row, '启用', presentation)}
        checked={row.isEnabled}
        disabled={rowIsLocked(row, pending)}
        onChange={(event) => onEdit('isEnabled', event.target.checked)}
      />
      <span>{row.isEnabled ? '启用' : '停用'}</span>
    </label>
  );
}

function RowStatus({ row }: { row: BulkFilterRow }) {
  const focusable = row.status === 'failed'
    || row.status === 'duplicate'
    || row.status === 'invalid'
    || row.status === 'ambiguous';
  const live = row.status === 'ambiguous' || row.status === 'reconciling';
  return (
    <div
      className={`bulk-row-status bulk-row-status--${row.status}`}
      tabIndex={focusable ? 0 : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <strong>{statusLabels[row.status]}</strong>
      {row.message && row.message !== statusLabels[row.status]
        ? <span>{row.message}</span>
        : null}
    </div>
  );
}

function RowActions({
  row,
  pending,
  presentation,
  retryEligible,
  onRemove,
  onRetry,
}: {
  row: BulkFilterRow;
  pending: boolean;
  presentation: Presentation;
  retryEligible: boolean;
  onRemove(): void;
  onRetry(): void;
}) {
  const locked = rowIsLocked(row, pending);
  return (
    <div className="bulk-row-actions">
      {row.status === 'failed' && row.remedy === 'retry' && retryEligible ? (
        <Button
          variant="secondary"
          size="compact"
          aria-label={controlLabel(row, '重试', presentation)}
          disabled={pending}
          onClick={onRetry}
        >重试</Button>
      ) : null}
      <Button
        variant="ghost"
        size="compact"
        aria-label={controlLabel(row, '移除', presentation)}
        disabled={locked}
        onClick={onRemove}
      >移除</Button>
    </div>
  );
}

function MobileField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bulk-import-card__field">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function FilterBulkImportDialog({
  open,
  categories,
  filters,
  filtersReady,
  onOpenChange,
  onImported,
}: FilterBulkImportDialogProps) {
  const runner = useBulkCreateFilters();
  const [rows, setRows] = useState<BulkFilterRow[]>([]);
  const [defaultCategoryId, setDefaultCategoryId] = useState(categories[0]?.id ?? '');
  const [defaultEnabled, setDefaultEnabled] = useState(true);
  const [rowErrors, setRowErrors] = useState<RowErrors>({});
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  const defaultCategoryRef = useRef(categories[0]?.id ?? '');
  const defaultEnabledRef = useRef(true);
  const filtersRef = useRef(filters);
  const filtersReadyRef = useRef(filtersReady);
  const inspectionGeneration = useRef(0);
  const dialogGeneration = useRef(0);
  const wasOpen = useRef(false);
  const runStarting = useRef(false);
  const reconcileStarting = useRef(false);
  const contentNode = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const hookBusy = runner.isPending || runner.isReconciling;
  const setContentRef = useCallback((content: HTMLDivElement | null) => {
    contentNode.current = content;
    const close = content?.querySelector<HTMLButtonElement>('.dialog__close');
    if (close) close.disabled = hookBusy;
  }, [hookBusy]);
  filtersRef.current = filters;
  filtersReadyRef.current = filtersReady;

  const clear = (categoryId: string) => {
    inspectionGeneration.current += 1;
    dialogGeneration.current += 1;
    defaultCategoryRef.current = categoryId;
    defaultEnabledRef.current = true;
    setRows([]);
    setDefaultCategoryId(categoryId);
    setDefaultEnabled(true);
    setRowErrors({});
    setSelectionError(null);
    setSummary(null);
    setProgress(null);
    setHasRun(false);
    setDiscardConfirmationOpen(false);
    runStarting.current = false;
    reconcileStarting.current = false;
  };

  useEffect(() => {
    if (open !== wasOpen.current) {
      clear(open ? categories[0]?.id ?? '' : '');
      wasOpen.current = open;
    } else if (open && !wasOpen.current) {
      clear(categories[0]?.id ?? '');
      wasOpen.current = true;
    }
  // Dialog sessions reset only on open/close transitions, not query refreshes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const availableCategoryIds = new Set(categories.map((category) => category.id));
    const currentDefault = defaultCategoryRef.current;
    const nextDefault = availableCategoryIds.has(currentDefault)
      ? currentDefault
      : categories[0]?.id ?? '';
    defaultCategoryRef.current = nextDefault;
    setDefaultCategoryId((current) => current === nextDefault ? current : nextDefault);
    setRows((current) => {
      let changed = false;
      const next = current.map<BulkFilterRow>((row) => {
        if (rowIsLocked(row, false)) return row;
        if (row.categoryOverridden) {
          if (!row.categoryId || availableCategoryIds.has(row.categoryId)) return row;
          changed = true;
          return { ...row, categoryId: '' };
        }
        if (row.categoryId === nextDefault) return row;
        changed = true;
        const updated: BulkFilterRow = { ...row, categoryId: nextDefault };
        return reviveForRemedy(updated, 'categoryId');
      });
      return changed ? next : current;
    });
    setRowErrors((current) => {
      let changed = false;
      const next = { ...current };
      for (const row of rows) {
        const categoryRemainsValid = row.categoryId && availableCategoryIds.has(row.categoryId);
        const inheritedReplacement = !row.categoryOverridden && Boolean(nextDefault);
        if (row.status !== 'success' && (categoryRemainsValid || inheritedReplacement) && next[row.id]?.categoryId) {
          const nextForRow = { ...next[row.id] };
          delete nextForRow.categoryId;
          if (Object.keys(nextForRow).length) next[row.id] = nextForRow;
          else delete next[row.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [categories, open, rows]);

  useEffect(() => {
    if (summary) summaryRef.current?.focus();
  }, [summary]);

  useEffect(() => {
    const close = contentNode.current?.querySelector<HTMLButtonElement>('.dialog__close');
    if (close) close.disabled = hookBusy;
  }, [hookBusy]);

  const requestClose = (next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (hookBusy || runStarting.current || reconcileStarting.current) return;
    if (rows.some((row) => row.status !== 'success')) {
      setDiscardConfirmationOpen(true);
      return;
    }
    onOpenChange(next);
  };

  const changeFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!filtersReadyRef.current) {
      event.target.value = '';
      setSelectionError('现有滤镜尚未加载完成，暂时无法选择文件或计算排序。');
      return;
    }
    const files = event.target.files;
    const generation = inspectionGeneration.current + 1;
    inspectionGeneration.current = generation;
    setRows([]);
    setRowErrors({});
    setSelectionError(null);
    setSummary(null);
    setProgress(null);
    setHasRun(false);
    if (!files?.length) return;

    try {
      const inspectedCategoryId = defaultCategoryRef.current;
      const next = await inspectBulkFilterFiles(Array.from(files), {
        categoryId: inspectedCategoryId,
        isEnabled: defaultEnabledRef.current,
        startingSortOrder: startingSortOrder(inspectedCategoryId, filtersRef.current),
      });
      if (inspectionGeneration.current !== generation || !filtersReadyRef.current) return;
      const latestCategoryId = defaultCategoryRef.current;
      const latestEnabled = defaultEnabledRef.current;
      const latestSortOrder = startingSortOrder(latestCategoryId, filtersRef.current);
      const materialized = next.map((row, index) => ({
        ...row,
        categoryId: latestCategoryId,
        isEnabled: latestEnabled,
        sortOrder: String(latestSortOrder + index),
      }));
      setRows(materialized);
      setProgress({ completed: 0, total: materialized.filter(isRunnable).length });
    } catch (error) {
      if (inspectionGeneration.current !== generation) return;
      setSelectionError(error instanceof Error ? error.message : '无法读取 NCP 文件，请重试');
    }
  };

  const clearRowError = (id: string, field: EditableField) => {
    setRowErrors((current) => {
      if (!current[id]?.[field]) return current;
      const nextForRow = { ...current[id] };
      delete nextForRow[field];
      const next = { ...current };
      if (Object.keys(nextForRow).length) next[id] = nextForRow;
      else delete next[id];
      return next;
    });
  };

  const editRow = (
    id: string,
    field: EditableField,
    value: string | boolean,
  ) => {
    setRows((current) => current.map((row) => {
      if (row.id !== id || rowIsLocked(row, false)) return row;
      let next = row;
      if (field === 'displayName' && typeof value === 'string') {
        if (row.displayName === value) return row;
        next = { ...row, displayName: value };
      } else if (field === 'categoryId' && typeof value === 'string') {
        if (row.categoryId === value) return row;
        next = { ...row, categoryId: value, categoryOverridden: true };
      } else if (field === 'sortOrder' && typeof value === 'string') {
        if (row.sortOrder === value) return row;
        next = { ...row, sortOrder: value };
      } else if (field === 'isEnabled' && typeof value === 'boolean') {
        if (row.isEnabled === value) return row;
        next = { ...row, isEnabled: value, enabledOverridden: true };
      }
      return reviveForRemedy(next, field);
    }));
    clearRowError(id, field);
    setSummary(null);
  };

  const changeDefaultCategory = (categoryId: string) => {
    defaultCategoryRef.current = categoryId;
    setDefaultCategoryId(categoryId);
    setRows((current) => current.map((row) => {
      if (row.categoryOverridden || rowIsLocked(row, false) || row.categoryId === categoryId) return row;
      return reviveForRemedy({ ...row, categoryId }, 'categoryId');
    }));
    setRowErrors((current) => {
      const next = { ...current };
      for (const row of rows) {
        if (!row.categoryOverridden && row.status !== 'success' && next[row.id]?.categoryId) {
          const nextForRow = { ...next[row.id] };
          delete nextForRow.categoryId;
          if (Object.keys(nextForRow).length) next[row.id] = nextForRow;
          else delete next[row.id];
        }
      }
      return next;
    });
    setSummary(null);
  };

  const changeDefaultEnabled = (isEnabled: boolean) => {
    defaultEnabledRef.current = isEnabled;
    setDefaultEnabled(isEnabled);
    setRows((current) => current.map((row) => {
      if (row.enabledOverridden || rowIsLocked(row, false) || row.isEnabled === isEnabled) return row;
      return { ...row, isEnabled };
    }));
    setSummary(null);
  };

  const removeRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
    setRowErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSummary(null);
  };

  const mergeRowUpdate = (id: string, update: BulkFilterRowUpdate) => {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...update } : row));
  };

  const runRows = async (candidateRows: readonly BulkFilterRow[]) => {
    if (hookBusy || runStarting.current || reconcileStarting.current) return;
    const errorsForRun: RowErrors = {};
    const runnableRows: BulkFilterRow[] = [];
    for (const row of candidateRows) {
      if (!isRunnable(row) || row.ncpBase64 === null) continue;
      const errors = filterClientErrors({
        displayName: row.displayName,
        categoryId: row.categoryId,
        description: '',
        slug: '',
        sortOrder: row.sortOrder,
      });
      if (!categories.some((category) => category.id === row.categoryId)) {
        errors.categoryId = row.categoryId
          ? '原分类已不可用，请重新选择分类'
          : '请选择分类';
      }
      if (Object.keys(errors).length) errorsForRun[row.id] = errors;
      else runnableRows.push(row);
    }

    setRowErrors((current) => {
      const next = { ...current };
      for (const row of candidateRows) delete next[row.id];
      return { ...next, ...errorsForRun };
    });
    setSummary(null);
    if (!runnableRows.length) return;

    runStarting.current = true;
    const generation = dialogGeneration.current;
    const completedIds = new Set<string>();
    const total = runnableRows.length;
    setProgress({ completed: 0, total });
    let result: BulkImportRunResult;
    try {
      result = await runner.run(runnableRows, (id, update) => {
        if (dialogGeneration.current !== generation) return;
        mergeRowUpdate(id, update);
        if (update.status !== 'importing' && !completedIds.has(id)) {
          completedIds.add(id);
          setProgress({ completed: completedIds.size, total });
        }
      });
    } catch {
      if (dialogGeneration.current !== generation) return;
      setHasRun(true);
      setSummary('批量导入未完成，请重试');
      return;
    } finally {
      runStarting.current = false;
    }

    if (dialogGeneration.current !== generation) return;
    setHasRun(true);
    setSummary(result.paused
      ? `导入已暂停，已完成 ${completedIds.size} / ${total}`
      : `已导入 ${result.createdCount} 个滤镜，${result.failedCount} 个需要处理`);
    try {
      await onImported(result);
    } catch {
      // Consumer notification failures must not rewrite the completed import outcome.
    }
  };

  const retryRow = (id: string) => {
    const row = rows.find((candidate) => candidate.id === id);
    if (row) void runRows([row]);
  };

  const reconcileAmbiguousRows = async () => {
    if (hookBusy || runStarting.current || reconcileStarting.current) return;
    const candidates = rows.filter((row) => row.status === 'ambiguous' && row.remedy === 'reconcile');
    if (!candidates.length) return;

    reconcileStarting.current = true;
    const generation = dialogGeneration.current;
    const candidateIds = new Set(candidates.map((row) => row.id));
    setSummary(null);
    setRows((current) => current.map((row) => candidateIds.has(row.id)
      ? { ...row, status: 'reconciling', message: '正在刷新服务器滤镜列表', remedy: 'reconcile' }
      : row));

    let authoritativeFilters: AdminFilter[];
    try {
      authoritativeFilters = await runner.reconcile();
    } catch {
      if (dialogGeneration.current !== generation) return;
      setRows((current) => current.map((row) => candidateIds.has(row.id)
        ? { ...row, status: 'ambiguous', message: '核对失败，请再次刷新并核对', remedy: 'reconcile' }
        : row));
      setSummary('刷新核对失败，请重试');
      return;
    } finally {
      reconcileStarting.current = false;
    }

    if (dialogGeneration.current !== generation) return;
    const committedHashes = new Set(authoritativeFilters.map((filter) => filter.ncpSha256));
    const matchedIds = new Set(candidates
      .filter((row) => row.ncpSha256 !== null && committedHashes.has(row.ncpSha256))
      .map((row) => row.id));
    const matchedCount = matchedIds.size;
    setRows((current) => current.map((row) => {
      if (!candidateIds.has(row.id)) return row;
      if (matchedIds.has(row.id)) {
        return { ...row, status: 'success', message: '已导入（核对确认）', remedy: 'none' };
      }
      return { ...row, status: 'failed', message: '服务器未找到该文件，可以重试', remedy: 'retry' };
    }));
    setHasRun(true);
    setSummary(`核对完成：确认已导入 ${matchedCount} 个，${candidates.length - matchedCount} 个可重试`);
  };

  const availableCategoryIds = new Set(categories.map((category) => category.id));
  const runnableCount = rows.filter((row) => (
    isRunnable(row) && availableCategoryIds.has(row.categoryId)
  )).length;
  const hasAmbiguous = rows.some((row) => row.status === 'ambiguous' || row.status === 'reconciling');
  const pending = hookBusy || runStarting.current || reconcileStarting.current;

  const rowControls = (row: BulkFilterRow, presentation: Presentation) => {
    const storedErrors = rowErrors[row.id] ?? {};
    const errors = row.status !== 'success' && !availableCategoryIds.has(row.categoryId)
      ? {
          ...storedErrors,
          categoryId: row.categoryOverridden
            ? '原分类已不可用，请重新选择分类'
            : '请选择分类',
        }
      : storedErrors;
    const onEdit = (field: EditableField, value: string | boolean) => editRow(row.id, field, value);
    return {
      name: (
        <RowNameControl
          row={row}
          error={errors.displayName}
          pending={pending}
          presentation={presentation}
          onEdit={onEdit}
        />
      ),
      category: (
        <RowCategoryControl
          row={row}
          categories={categories}
          error={errors.categoryId}
          pending={pending}
          presentation={presentation}
          onEdit={onEdit}
        />
      ),
      order: (
        <RowOrderControl
          row={row}
          error={errors.sortOrder}
          pending={pending}
          presentation={presentation}
          onEdit={onEdit}
        />
      ),
      enabled: (
        <RowEnabledControl
          row={row}
          pending={pending}
          presentation={presentation}
          onEdit={onEdit}
        />
      ),
      status: <RowStatus row={row} />,
      actions: (
        <RowActions
          row={row}
          pending={pending}
          presentation={presentation}
          retryEligible={availableCategoryIds.has(row.categoryId)}
          onRemove={() => removeRow(row.id)}
          onRetry={() => retryRow(row.id)}
        />
      ),
    };
  };

  const readinessDescriptionId = 'filter-bulk-ncp-readiness';

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          ref={setContentRef}
          className={`filter-bulk-import-dialog${pending ? ' filter-bulk-import-dialog--pending' : ''}`}
        >
          <DialogHeader>
            <DialogTitle>批量导入滤镜</DialogTitle>
            <DialogDescription>本地检查最多 100 个 NCP 文件，再逐个提交可用项。</DialogDescription>
          </DialogHeader>
          <div className="filter-bulk-import-form">
            <div className="ncp-upload">
              <label htmlFor="filter-bulk-ncp-files">NCP 文件（可多选）</label>
              <input
                id="filter-bulk-ncp-files"
                type="file"
                multiple
                accept=".ncp,application/octet-stream"
                aria-describedby={!filtersReady ? readinessDescriptionId : undefined}
                disabled={pending || !filtersReady}
                onChange={(event) => void changeFiles(event)}
              />
              {!filtersReady ? (
                <p id={readinessDescriptionId}>
                  现有滤镜尚未加载完成，暂时无法选择文件或计算排序。
                </p>
              ) : (
                <p>一次最多选择 100 个文件；无效项和重复项会留在列表中供检查。</p>
              )}
            </div>
            {selectionError ? <p className="form-alert" role="alert">{selectionError}</p> : null}
            {!categories.length ? (
              <div className="form-warning"><p>导入滤镜前，请先创建至少一个分类。</p></div>
            ) : null}
            <div className="bulk-import-defaults">
              <Field
                label="默认分类"
                description="仅更新尚未单独修改且未成功导入的行；不会重算可见排序。"
              >
                <select
                  value={defaultCategoryId}
                  disabled={pending || !categories.length}
                  onChange={(event) => changeDefaultCategory(event.target.value)}
                >
                  {!defaultCategoryId ? <option value="">无可用分类</option> : null}
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </Field>
              <div className="field">
                <div className="field__label-row"><span>默认启用状态</span></div>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    aria-label="默认启用状态"
                    checked={defaultEnabled}
                    disabled={pending}
                    onChange={(event) => changeDefaultEnabled(event.target.checked)}
                  />
                  <span>{defaultEnabled ? '默认启用' : '默认停用'}</span>
                </label>
                <p className="field__description">单独修改的行不会跟随后续默认值变化。</p>
              </div>
            </div>

            <div className="bulk-import-summary-bar">
              <p>已选择 {rows.length} 个文件，其中 {runnableCount} 个当前可导入。</p>
              <p role="status" aria-live="polite">
                导入进度：{progress?.completed ?? 0} / {progress?.total ?? 0}
              </p>
            </div>
            {summary ? (
              <p ref={summaryRef} className="bulk-import-run-summary" role="alert" tabIndex={-1}>
                {summary}
              </p>
            ) : null}

            {rows.length ? (
              <>
                <div className="bulk-import-table-wrap">
                  <table className="bulk-import-table" aria-label="待导入滤镜">
                    <thead>
                      <tr>
                        <th>文件 / 来源</th>
                        <th>显示名称</th>
                        <th>分类</th>
                        <th>排序</th>
                        <th>启用</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const controls = rowControls(row, 'desktop');
                        return (
                          <tr key={row.id}>
                            <td>
                              <strong>{row.fileName}</strong>
                              <span className="record-secondary">
                                {row.inspection?.parsed.sourceName ?? '未解析'}
                              </span>
                            </td>
                            <td>{controls.name}</td>
                            <td>{controls.category}</td>
                            <td>{controls.order}</td>
                            <td>{controls.enabled}</td>
                            <td>{controls.status}</td>
                            <td>{controls.actions}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="bulk-import-cards">
                  {rows.map((row) => {
                    const controls = rowControls(row, 'mobile');
                    return (
                      <article className="bulk-import-card" key={row.id}>
                        <header>
                          <div>
                            <h3>{row.fileName}</h3>
                            <p>{row.inspection?.parsed.sourceName ?? '未解析'}</p>
                          </div>
                          {controls.status}
                        </header>
                        <MobileField label="显示名称">{controls.name}</MobileField>
                        <MobileField label="分类">{controls.category}</MobileField>
                        <MobileField label="排序">{controls.order}</MobileField>
                        <MobileField label="启用状态">{controls.enabled}</MobileField>
                        {controls.actions}
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="bulk-import-empty">选择 NCP 文件后，可在这里逐项检查发布信息。</p>
            )}

            <DialogFooter>
              <Button variant="ghost" disabled={pending} onClick={() => requestClose(false)}>取消</Button>
              {hasAmbiguous ? (
                <Button
                  disabled={pending}
                  onClick={() => void reconcileAmbiguousRows()}
                >{pending ? '核对中' : '刷新并核对'}</Button>
              ) : (
                <Button
                  disabled={pending || runnableCount === 0}
                  onClick={() => void runRows(rows)}
                >{hasRun ? '继续导入' : '导入可用项'}</Button>
              )}
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={discardConfirmationOpen} onOpenChange={setDiscardConfirmationOpen}>
        <DialogContent className="bulk-import-discard-dialog">
          <DialogHeader>
            <DialogTitle>放弃未完成的批量导入？</DialogTitle>
            <DialogDescription>
              仍有未完成的本地导入项。关闭后将丢弃这些行，但已导入的滤镜不会被删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardConfirmationOpen(false)}>继续编辑</Button>
            <Button
              variant="danger"
              onClick={() => {
                setDiscardConfirmationOpen(false);
                onOpenChange(false);
              }}
            >放弃并关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
