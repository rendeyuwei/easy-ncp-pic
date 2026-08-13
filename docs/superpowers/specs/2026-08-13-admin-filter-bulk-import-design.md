# EasyPic Admin Filter Bulk Import Design

**Date:** 2026-08-13

## 1. Goal

Allow the single administrator to select and import many supported `.ncp` filters in one workflow while retaining per-filter control over category and essential publishing metadata.

The workflow optimizes the common case where most files share one category, while supporting mixed-category batches without requiring separate uploads.

## 2. Scope and Constraints

- Keep the existing single-filter “新增滤镜” workflow.
- Add a separate “批量导入” workflow for up to 100 files per selection.
- Reuse the existing authenticated `POST /api/admin/filters` contract one item at a time.
- Preserve the current 64 KiB per-request limit and server-side NCP parsing, SHA-256 duplicate detection, CSRF handling, and database constraints.
- Do not add a batch API or database transaction. Partial success is approved behavior.

## 3. Chosen Workflow

### 3.1 File selection and local inspection

The administrator opens “批量导入” and selects up to 100 `.ncp` files. The browser inspects each file locally with the existing inspector.

Each row records:

- Local file name.
- Parsed NCP source name.
- Display name, initially the parsed source name.
- Category.
- Sort order.
- Enabled state.
- Validation/import status.

Invalid, oversized, unsupported, or unreadable files remain visible as failed rows and are never submitted. The administrator can remove them or select files again. Duplicate files within the same selection are detected locally by identical bytes and marked before upload; the server remains authoritative for duplicates already stored in the database.

### 3.2 Defaults and per-row overrides

The dialog has batch defaults:

- **Default category:** required and initially the first available category. Every inspected row inherits it.
- **Default enabled state:** initially enabled to match the existing single-create workflow. Changing it updates rows that have not been individually overridden.

Every valid row can override its category, display name, sort order, and enabled state. Slug is omitted so the server derives it from the display name. Description is omitted in bulk creation and can be edited after import.

Initial sort orders are assigned from the selected default category's current maximum sort order plus the file selection index. Changing a row's category does not silently rewrite a manually visible sort value; the administrator can edit it directly.

### 3.3 Import queue

“导入可用项” processes eligible rows sequentially through the existing single-create API.

- A successful row becomes locked and shows “已导入”.
- Duplicate NCP, slug conflict, validation, or category errors remain on that row with an actionable message.
- Other eligible rows continue after an item-level server error.
- A definite connection failure pauses the remaining queue because the server may have committed a request whose response was lost.
- The dialog offers “继续导入” after the administrator refreshes/reconciles the list or edits failed rows.
- Successful rows are not submitted again.
- The filter query is invalidated once after a run that creates at least one filter, rather than after every row.

Closing the dialog is disabled while a request is active. After a paused or completed run, closing is allowed; successful records remain in the database and unfinished local rows are discarded after confirmation if necessary.

## 4. Architecture

### 4.1 Admin UI

Add a dedicated `FilterBulkImportDialog`; do not expand the single-create dialog into two modes.

The bulk dialog owns:

- File inspection generation and stale-result protection.
- Batch defaults and per-row override state.
- Sequential import coordination.
- Row-level validation and status presentation.
- Retry/pause behavior.

Shared single-create metadata validation and API error mapping move into a small filter-form utility so single and bulk workflows use identical limits and messages.

Desktop uses a wide table. Narrow screens render the same fields and actions as stacked cards; no controls disappear on mobile.

### 4.2 Data access

Add a bulk coordinator that calls `api.createFilter` sequentially and performs one final query invalidation. It is not a TanStack automatic retry loop. The coordinator returns per-item results so the dialog can preserve partial success.

The API server, database schema, and filter repository do not change.

## 5. Validation and Error Mapping

- Maximum selection: 100 files. Larger selections are rejected before reading bytes.
- Empty, oversized, invalid, and unsupported files use the existing local inspection messages.
- Missing display name, overlong display name, missing category, and non-integer sort order are row-level client errors.
- `DUPLICATE_NCP`: show “已存在” and keep the row available for removal; retrying unchanged bytes is disabled.
- `SLUG_CONFLICT`: keep the row failed. Because bulk mode omits explicit slug editing, the administrator must change the display name or finish that item with the single-create workflow.
- Category validation failure: retain the row and require another category.
- Authentication expiry follows the existing global session behavior.
- A confirmed offline/network failure pauses the queue; ordinary item-level `4xx` and `5xx` responses do not roll back prior successes.

## 6. Accessibility and Feedback

- The dialog has a clear title, description, file-count summary, and live import progress.
- Every row status is expressed in text, not color alone.
- Invalid fields are associated with their row-specific messages.
- Pending rows and active controls remain keyboard reachable; successful rows are read-only.
- The default controls explain that row-level edits override subsequent batch-default changes.
- Focus moves to the batch summary after a run, and the first failed row is easy to reach.

## 7. Testing

Unit and integration coverage must verify:

- Selecting multiple valid files creates one row per file with inherited defaults.
- The 100-file boundary and mixed valid/invalid files.
- Default category and enabled-state changes affect only non-overridden rows.
- Each row can independently change category, name, order, and enabled state.
- Local duplicate detection and server duplicate mapping.
- Sequential requests, partial success, and a single final query invalidation.
- Item-level errors continue the queue; network ambiguity pauses it.
- Successful rows are never resubmitted during retry.
- Closing/resetting the dialog invalidates outstanding inspection results.
- Desktop table and mobile cards expose equivalent actions.
- E2E imports multiple fixtures into different categories and verifies the resulting filter list.

## 8. Acceptance Criteria

- The administrator can select and inspect up to 100 NCP files at once.
- Rows inherit one default category but each row can choose another category.
- Valid rows continue importing when another row is invalid, duplicate, or rejected.
- Failed rows remain understandable and retryable without reimporting successful rows.
- Existing single-create behavior and all server security checks remain unchanged.

## 9. Out of Scope

- All-or-nothing batch transactions.
- ZIP or directory upload.
- Bulk editing or deletion of existing filters.
- Per-row descriptions or explicit slugs in the bulk dialog.
- Parallel HTTP imports.
