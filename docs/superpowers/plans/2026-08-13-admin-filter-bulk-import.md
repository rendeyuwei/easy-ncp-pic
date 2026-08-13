# Admin Filter Bulk Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an administrator inspect and import up to 100 NCP filters in one workflow, using one default category with per-row overrides and preserving failed rows for retry.

**Architecture:** A pure bulk-import model will inspect files and coordinate sequential calls to the existing single-create API. A dedicated responsive dialog owns defaults, row edits, status, pause, and retry behavior. The API server and database remain unchanged; one query invalidation occurs after each run that creates records.

**Tech Stack:** React 19, TypeScript, TanStack Query, Testing Library, MSW, Playwright, existing NCP parser and admin API client.

## Global Constraints

- Select at most 100 files; reject larger selections before reading any bytes.
- Reuse `POST /api/admin/filters` sequentially and preserve the 64 KiB per-request limit.
- Server parsing, SHA-256 duplicate checks, CSRF restoration, authentication expiry, and database constraints remain authoritative.
- Partial success is required; successful rows are never resubmitted.
- Network error code `NETWORK_ERROR`/status `0` pauses the queue; item-level HTTP errors continue it.
- Preserve the existing single-filter dialog and do not modify API-server or database production code.
- Never stage unrelated local startup-script, environment, editor, or historical-plan changes.

---

### Task 1: Share filter-create validation and error mapping

**Files:**
- Create: `packages/admin-app/src/features/filters/filter-form.ts`
- Create: `packages/admin-app/src/test/filter-form.test.ts`
- Modify: `packages/admin-app/src/features/filters/filter-create-dialog.tsx:24-94,165-199`
- Modify: `packages/admin-app/src/test/filter-create.test.tsx`

**Interfaces:**
- Produces: `FilterFieldName`, `FilterFieldErrors`.
- Produces: `filterClientErrors(input): FilterFieldErrors`.
- Produces: `mapFilterCreateError(error): { fields; summary; retryable }`.
- Produces: `ncpInspectionMessage(error): string`.

- [ ] **Step 1: Add failing pure-function tests**

Test exact existing bounds and mappings:

```ts
expect(filterClientErrors({
  displayName: ' ', categoryId: '', description: '', slug: '', sortOrder: 'x',
})).toEqual({
  displayName: '请输入显示名称',
  categoryId: '请选择分类',
  sortOrder: '排序必须是整数',
});

expect(mapFilterCreateError(
  new ApiFailure(409, 'DUPLICATE_NCP', 'duplicate'),
)).toMatchObject({ summary: '该 NCP 已经发布，请选择其他文件', retryable: false });

expect(mapFilterCreateError(
  new ApiFailure(0, 'NETWORK_ERROR', 'offline'),
)).toMatchObject({ summary: '网络连接中断，导入已暂停', retryable: true });
```

- [ ] **Step 2: Run the new test to verify the module is missing**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-form.test.ts`

Expected: FAIL because `filter-form.ts` does not exist.

- [ ] **Step 3: Extract the existing rules without changing single-create behavior**

Define one input type and preserve all current copy:

```ts
export interface FilterFormValues {
  displayName: string;
  categoryId: string;
  description: string;
  slug: string;
  sortOrder: string;
}

export function filterClientErrors(values: FilterFormValues): FilterFieldErrors {
  // use Array.from for the existing Unicode code-point bounds
}
```

Move the `ApiFailure` mapping and `NcpInspectionError` copy from `FilterCreateDialog` into this module. The dialog imports these functions and retains its existing UI and request payload.

- [ ] **Step 4: Verify the extraction**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-form.test.ts src/test/filter-create.test.tsx && pnpm --filter @easypic/admin-app typecheck`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit the shared form boundary**

```bash
git add packages/admin-app/src/features/filters/filter-form.ts packages/admin-app/src/features/filters/filter-create-dialog.tsx packages/admin-app/src/test/filter-form.test.ts packages/admin-app/src/test/filter-create.test.tsx
git commit -m "refactor(admin-app): share filter form rules"
```

### Task 2: Build the bulk inspection model

**Files:**
- Create: `packages/admin-app/src/features/filters/filter-bulk-import.ts`
- Create: `packages/admin-app/src/test/filter-bulk-import.test.ts`

**Interfaces:**
- Produces: `MAX_BULK_FILTER_FILES = 100`.
- Produces: `BulkFilterRow` and `BulkFilterStatus`.
- Produces: `inspectBulkFilterFiles(files, defaults): Promise<BulkFilterRow[]>`.
- Consumes: `inspectNcpFile`, `bytesToBase64`, and `ncpInspectionMessage`.

- [ ] **Step 1: Add model tests with real NCP fixtures**

Cover order, inherited defaults, mixed validity, duplicate bytes, and the 100-file boundary:

```ts
const rows = await inspectBulkFilterFiles(
  [fixtureFile(fixture02, 'a.NCP'), fixtureFile(fixture33, 'b.NCP')],
  { categoryId: 'film', isEnabled: true, startingSortOrder: 21 },
);
expect(rows.map((row) => [row.displayName, row.categoryId, row.sortOrder])).toEqual([
  ['Fuji Astia', 'film', '21'],
  ['SHING TokugawaTone2', 'film', '22'],
]);
```

Selecting 101 files must reject with `一次最多选择 100 个 NCP 文件` before any mocked `arrayBuffer` is called. Two byte-identical files must leave the first `ready` and mark the second `duplicate`.

- [ ] **Step 2: Run model tests to establish RED**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-bulk-import.test.ts`

Expected: FAIL because the bulk model does not exist.

- [ ] **Step 3: Implement typed rows and deterministic inspection**

Use stable IDs independent of file names:

```ts
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
```

Inspect with `Promise.all` but return rows in input order. Use the Base64 bytes as the batch-local duplicate key after successful inspection. Invalid rows contain no bytes and an existing inspection message.

- [ ] **Step 4: Run model tests and typecheck**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-bulk-import.test.ts && pnpm --filter @easypic/admin-app typecheck`

Expected: tests PASS.

- [ ] **Step 5: Commit the inspection model**

```bash
git add packages/admin-app/src/features/filters/filter-bulk-import.ts packages/admin-app/src/test/filter-bulk-import.test.ts
git commit -m "feat(admin-app): inspect bulk filter files"
```

### Task 3: Coordinate sequential partial-success imports

**Files:**
- Modify: `packages/admin-app/src/features/filters/filter-bulk-import.ts`
- Modify: `packages/admin-app/src/test/filter-bulk-import.test.ts`
- Modify: `packages/admin-app/src/features/filters/filter-queries.ts`

**Interfaces:**
- Produces: `runBulkFilterImport(rows, create, onRow): Promise<BulkImportRunResult>`.
- Produces: `useBulkCreateFilters()` returning `{ run(rows, onRow), isPending }`.
- `BulkImportRunResult` contains `createdCount`, `failedCount`, and `paused`.

- [ ] **Step 1: Add RED tests for sequential execution and pause behavior**

Use deferred calls to prove the second create does not begin before the first resolves. Return a duplicate error for row 2 and success for row 3; assert row 3 still runs. In another test, return `ApiFailure(0, 'NETWORK_ERROR', ...)` for row 2 and assert row 3 remains ready and `paused === true`.

```ts
expect(create).toHaveBeenCalledTimes(1);
first.resolve(filterFixture);
await waitForCallCount(create, 2);
expect(result).toEqual({ createdCount: 2, failedCount: 1, paused: false });
```

- [ ] **Step 2: Run the coordinator tests and observe RED**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-bulk-import.test.ts`

Expected: FAIL because no queue coordinator exists.

- [ ] **Step 3: Implement the pure sequential coordinator**

For each eligible row:

```ts
onRow(row.id, { status: 'importing', message: null });
try {
  await create(toFilterCreateInput(row));
  onRow(row.id, { status: 'success', message: '已导入' });
  createdCount += 1;
} catch (error) {
  const mapped = mapFilterCreateError(error);
  onRow(row.id, {
    status: error instanceof ApiFailure && error.code === 'DUPLICATE_NCP' ? 'duplicate' : 'failed',
    message: mapped.summary ?? Object.values(mapped.fields)[0] ?? '导入失败，请重试',
  });
  if (error instanceof ApiFailure && error.status === 0) return { createdCount, failedCount, paused: true };
}
```

Skip `success`, `invalid`, `duplicate`, and client-invalid rows. Never retry automatically.

- [ ] **Step 4: Wrap the coordinator with one query invalidation**

`useBulkCreateFilters` gets `api` and `queryClient`, sets hook-local pending state, invokes the coordinator, and calls:

```ts
if (result.createdCount > 0) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.filters });
}
```

Do not call the existing `useCreateFilter`, because its `onSuccess` invalidates after every row.

- [ ] **Step 5: Verify coordinator and query types**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-bulk-import.test.ts && pnpm --filter @easypic/admin-app typecheck`

Expected: tests PASS.

- [ ] **Step 6: Commit queue coordination**

```bash
git add packages/admin-app/src/features/filters/filter-bulk-import.ts packages/admin-app/src/features/filters/filter-queries.ts packages/admin-app/src/test/filter-bulk-import.test.ts
git commit -m "feat(admin-app): import filters sequentially"
```

### Task 4: Build the responsive bulk-import dialog

**Files:**
- Create: `packages/admin-app/src/features/filters/filter-bulk-import-dialog.tsx`
- Create: `packages/admin-app/src/test/filter-bulk-import-dialog.test.tsx`
- Modify: `packages/admin-app/src/styles.css`

**Interfaces:**
- Consumes: `categories: AdminCategory[]`, `filters: AdminFilter[]`, and `useBulkCreateFilters` runner.
- Produces: controlled dialog props `{ open, categories, filters, onOpenChange, onImported }`.

- [ ] **Step 1: Add RED tests for selection, inheritance, and overrides**

Render the dialog with two categories and upload two real fixtures via an input labeled `NCP 文件（可多选）`. Assert two rows, default category inheritance, sort orders after the category maximum, and default enabled state.

Change the batch default category and assert both untouched rows change. Override row A's category, then change the default again and assert only row B follows. Repeat for enabled state. Edit each row's name and order independently.

- [ ] **Step 2: Add RED tests for import status and retry**

Mock the runner's row callback so A succeeds, B becomes duplicate, and C fails. Assert:

- A controls are read-only and its retry is impossible.
- B says `已存在`.
- C keeps its edited inputs and can be retried.
- Progress uses `role="status"` and reports completed/total.
- Closing is blocked only while a request is active.

- [ ] **Step 3: Run the dialog tests to establish RED**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-bulk-import-dialog.test.tsx`

Expected: FAIL because the dialog does not exist.

- [ ] **Step 4: Implement stale-safe multi-file selection**

Use a generation ref like the single-create dialog:

```ts
const inspectionGeneration = useRef(0);
const changeFiles = async (files: FileList | null) => {
  const generation = ++inspectionGeneration.current;
  if (!files) return;
  const next = await inspectBulkFilterFiles(Array.from(files), defaults);
  if (generation === inspectionGeneration.current) setRows(next);
};
```

Reset generation and rows when opening/closing. Set `multiple` and `accept=".ncp,application/octet-stream"` on the input.

- [ ] **Step 5: Implement defaults and per-row overrides**

Store category/enabled override flags on each row. Batch-default changes update only rows whose corresponding override flag is false and whose status is not `success`. Row edits set the flag true. Validate name/category/order before calling the runner and associate messages with row-specific control IDs.

- [ ] **Step 6: Implement desktop table and equivalent mobile cards**

Render a `.bulk-import-table` and `.bulk-import-cards` from the same `rows`. Both expose file/source, display name, category, sort order, enabled state, status, and remove/retry actions. Give duplicated responsive controls distinct labels such as `${fileName} 分类（桌面）` and `${fileName} 分类（移动）`; CSS hides one presentation at each breakpoint.

Use a dialog width of `min(calc(100vw - 32px), 1120px)`. At `max-width: 760px`, hide the table and show full-width stacked cards.

- [ ] **Step 7: Run dialog tests and typecheck**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-bulk-import-dialog.test.tsx && pnpm --filter @easypic/admin-app typecheck`

Expected: all dialog tests PASS.

- [ ] **Step 8: Commit the dialog**

```bash
git add packages/admin-app/src/features/filters/filter-bulk-import-dialog.tsx packages/admin-app/src/test/filter-bulk-import-dialog.test.tsx packages/admin-app/src/styles.css
git commit -m "feat(admin-app): add bulk filter import dialog"
```

### Task 5: Integrate the filter page and prove partial success

**Files:**
- Modify: `packages/admin-app/src/features/filters/filter-page.tsx`
- Modify: `packages/admin-app/src/test/filter-create.test.tsx`
- Modify: `packages/admin-app/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `FilterBulkImportDialog` from Task 4.
- Produces: a “批量导入” page action available under the same category-readiness rules as “新增滤镜”.

- [ ] **Step 1: Add page integration tests**

Assert both create actions are disabled while categories load or fail. After categories succeed, click `批量导入` and assert the dialog receives current categories and filter sort orders. Run two POST handlers where one succeeds and one returns `DUPLICATE_NCP`; assert the success notification summarizes `已导入 1 个滤镜，1 个需要处理` and the list GET is refreshed once after the run.

- [ ] **Step 2: Run the integration tests to establish RED**

Run: `pnpm --filter @easypic/admin-app test -- --run src/test/filter-create.test.tsx src/test/filter-bulk-import-dialog.test.tsx`

Expected: FAIL because the page has no bulk action.

- [ ] **Step 3: Add the page action and controlled dialog**

Add `bulkOpen` state and group the actions:

```tsx
<div className="page-heading__actions">
  <Button variant="secondary" disabled={createUnavailable} onClick={() => setBulkOpen(true)}>
    <Files aria-hidden="true" />批量导入
  </Button>
  <Button disabled={createUnavailable} onClick={openCreate}>
    <Plus aria-hidden="true" />新增滤镜
  </Button>
</div>
```

Render the bulk dialog with `filters.data ?? []`. Its `onImported` sends the summary notification and leaves failed rows open.

- [ ] **Step 4: Extend the real admin E2E**

Create two temporary categories, select `PICCON02.NCP` and `PICCON33.NCP` in one multi-file input, set the second row to the other category, import, and assert both rows appear with different category names. Delete both filters and categories in cleanup so the shared SQLite fixture remains isolated.

- [ ] **Step 5: Run repeated focused and full admin verification**

Run:

```bash
pnpm --filter @easypic/admin-app test -- --run src/test/filter-create.test.tsx src/test/filter-bulk-import.test.ts src/test/filter-bulk-import-dialog.test.tsx
pnpm --filter @easypic/admin-app test:e2e -- --project=desktop
pnpm --filter @easypic/admin-app test
pnpm --filter @easypic/admin-app typecheck
pnpm --filter @easypic/admin-app build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 6: Commit page integration and E2E**

```bash
git add packages/admin-app/src/features/filters/filter-page.tsx packages/admin-app/src/test/filter-create.test.tsx packages/admin-app/e2e/admin.spec.ts
git commit -m "feat(admin-app): integrate bulk filter import"
```

### Task 6: Run repository-wide completion checks

**Files:**
- No production file is expected to change.

**Interfaces:**
- Consumes: completed public-editor and admin bulk-import implementations.
- Produces: fresh verification evidence for the complete repository.

- [ ] **Step 1: Run all unit/integration tests**

Run: `pnpm test`

Expected: all workspace Vitest suites PASS.

- [ ] **Step 2: Run all typechecks and builds**

Run: `pnpm -r typecheck && pnpm -r build`

Expected: every package exits 0.

- [ ] **Step 3: Run both browser suites**

Run: `pnpm --filter @easypic/web-app test:e2e && pnpm --filter @easypic/admin-app test:e2e`

Expected: desktop and mobile projects PASS.

- [ ] **Step 4: Audit the final diff and worktree separation**

Run:

```bash
git diff --check
git status --short
git log --oneline -12
```

Expected: no whitespace errors; unrelated local `.env`, startup scripts, historical plans, and SQLite files remain uncommitted and absent from scoped feature commits.
