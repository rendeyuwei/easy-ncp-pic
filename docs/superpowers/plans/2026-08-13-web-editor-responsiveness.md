# Web Editor Comparison and Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the original photo on the left and the filtered photo on the right, while preventing thumbnail and rapid-selection work from making the first filter interaction appear frozen.

**Architecture:** `PhotoCompare` will use one shared definition of divider position: the percent of original image visible from the left. `FilterBrowser` will report its active category and distinguish pending from committed selection. `useImageSession` will generate requested thumbnails sequentially and coalesce main-preview requests so at most one render is executing and one latest request is queued.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Playwright, Web Worker image engine.

## Global Constraints

- Photos remain browser-local; no photo bytes or local names may be sent to an API.
- Preserve the existing filter parameters, 2048 px default preview, 1280 px low-memory preview, Canvas fallback, and Worker protocol.
- A stale async operation may not commit pixels, selection, progress, error, or busy state.
- Use existing uncommitted editor safety fixes as the implementation baseline; never stage `.gitignore`, root `package.json`, `.env.local.example`, `scripts/`, or unrelated historical plans.
- Every behavior change starts with a failing regression test.

---

### Task 1: Make comparison direction unambiguous

**Files:**
- Modify: `packages/web-app/src/components/photo-compare.tsx:80-111`
- Modify: `packages/web-app/src/test/photo-compare.test.tsx:24-92`
- Modify: `packages/web-app/src/test/app.test.tsx:90-105`

**Interfaces:**
- Consumes: `PhotoCompareProps { original, filtered, showOriginal }`.
- Produces: divider `position` whose value is the percentage of original pixels visible from the left.

- [ ] **Step 1: Rewrite the direction assertions before production code**

Update the focused tests to assert both semantics and pixels:

```tsx
expect(screen.getByTestId('filtered-layer')).toHaveStyle({
  clipPath: 'inset(0 0 0 50%)',
});
expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '原图 50%');
expect(screen.getByText('原图')).toHaveStyle({ left: '12px' });
expect(screen.getByText('滤镜')).toHaveStyle({ right: '12px' });

fireEvent.keyDown(slider, { key: 'Home' });
expect(filteredLayer).toHaveStyle({ clipPath: 'inset(0 0 0 0%)' });
fireEvent.keyDown(slider, { key: 'End' });
expect(filteredLayer).toHaveStyle({ clipPath: 'inset(0 0 0 100%)' });
```

Retain the existing `showOriginal` assertions, changing the hidden filtered layer to `inset(0 0 0 100%)`.

- [ ] **Step 2: Run the focused test and observe the direction failure**

Run: `pnpm --filter @easypic/web-app test -- --run src/test/photo-compare.test.tsx src/test/app.test.tsx`

Expected: FAIL because the overlay currently clips from the right and labels the left side as filtered.

- [ ] **Step 3: Change clipping, labels, and accessible value together**

Use the same `position` in all three places:

```tsx
style={{ clipPath: `inset(0 0 0 ${showOriginal ? 100 : position}%)` }}
// ...
aria-valuetext={`原图 ${position}%`}
// ...
<span className="photo-compare__label" style={{ left: '12px' }}>原图</span>
<span className="photo-compare__label" style={{ right: '12px' }}>滤镜</span>
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @easypic/web-app test -- --run src/test/photo-compare.test.tsx src/test/app.test.tsx && pnpm --filter @easypic/web-app typecheck`

Expected: all selected tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit only the comparison files**

```bash
git add packages/web-app/src/components/photo-compare.tsx packages/web-app/src/test/photo-compare.test.tsx packages/web-app/src/test/app.test.tsx packages/web-app/src/styles.css
git commit -m "fix(web-app): show original on comparison left"
```

### Task 2: Expose active-category and pending-filter intent

**Files:**
- Modify: `packages/web-app/src/components/filter-browser.tsx`
- Modify: `packages/web-app/src/components/editor-shell.tsx`
- Modify: `packages/web-app/src/hooks/use-image-session.ts:12-37`
- Modify: `packages/web-app/src/test/filter-browser.test.tsx`
- Modify: `packages/web-app/src/test/app.test.tsx`
- Modify: `packages/web-app/src/styles.css`

**Interfaces:**
- Produces: `ImageSessionState.pendingFilter: PublicFilter | null`.
- Produces: `ImageSessionState.requestThumbnails(filters: ReadonlyArray<PublicFilter>): void`.
- `FilterBrowser` adds `pendingFilterId: string | null` and `onVisibleFiltersChange(filters): void`.

- [ ] **Step 1: Add failing browser-component tests**

Add tests that the first category is reported on mount, a new category is reported after a tab change, and pending state differs from committed state:

```tsx
const onVisibleFiltersChange = vi.fn();
render(<FilterBrowser
  categories={categories}
  selectedFilterId={filmFilter.id}
  pendingFilterId={monoFilter.id}
  thumbnails={new Map()}
  loadingIds={new Set()}
  onVisibleFiltersChange={onVisibleFiltersChange}
  onSelect={vi.fn()}
/>);
expect(onVisibleFiltersChange).toHaveBeenCalledWith(categories[0].filters);
expect(screen.getByRole('button', { name: /Fuji Astia/ })).toHaveAttribute('aria-pressed', 'true');
```

After selecting the second tab, expect `onVisibleFiltersChange(categories[1].filters)` and the pending card to expose `aria-busy="true"` plus visible text `正在应用`.

- [ ] **Step 2: Run the component tests to establish RED**

Run: `pnpm --filter @easypic/web-app test -- --run src/test/filter-browser.test.tsx src/test/app.test.tsx`

Expected: FAIL because the new props and pending presentation do not exist.

- [ ] **Step 3: Control the active tab and report visible filters**

Use a controlled category ID and an effect:

```tsx
const [activeCategoryId, setActiveCategoryId] = useState(firstCategory.id);
const activeCategory = categories.find((item) => item.id === activeCategoryId) ?? firstCategory;

useEffect(() => {
  onVisibleFiltersChange(activeCategory.filters);
}, [activeCategory, onVisibleFiltersChange]);

<Tabs value={activeCategory.id} onValueChange={setActiveCategoryId}>
```

For each card, set `aria-busy={pendingFilterId === filter.id || undefined}` and render `正在应用` without replacing its accessible filter name.

- [ ] **Step 4: Wire the new session fields through `EditorShell`**

```tsx
<FilterBrowser
  selectedFilterId={session.selectedFilter?.id ?? null}
  pendingFilterId={session.pendingFilter?.id ?? null}
  onVisibleFiltersChange={session.requestThumbnails}
  // existing props
/>
```

Show `正在应用 {session.pendingFilter.displayName}…` in the live notice region. Keep the main heading tied to `selectedFilter`, which represents committed pixels.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @easypic/web-app test -- --run src/test/filter-browser.test.tsx src/test/app.test.tsx && pnpm --filter @easypic/web-app typecheck`

Expected: selected tests PASS.

- [ ] **Step 6: Commit the presentation seam**

```bash
git add packages/web-app/src/components/filter-browser.tsx packages/web-app/src/components/editor-shell.tsx packages/web-app/src/hooks/use-image-session.ts packages/web-app/src/test/filter-browser.test.tsx packages/web-app/src/test/app.test.tsx packages/web-app/src/styles.css
git commit -m "feat(web-app): expose pending filter work"
```

### Task 3: Generate thumbnails incrementally

**Files:**
- Modify: `packages/web-app/src/hooks/use-image-session.ts:95-181,207-305`
- Modify: `packages/web-app/src/test/use-image-session.test.tsx`

**Interfaces:**
- Consumes: `requestThumbnails(filters)` added in Task 2.
- Produces: a photo-scoped FIFO thumbnail queue with one in-flight request.

- [ ] **Step 1: Add controlled deferred-thumbnail tests**

Create three filters and deferred thumbnail responses. Assert that only the first request is submitted until it resolves:

```tsx
act(() => result.current.requestThumbnails(filters));
expect(engine.renderThumbnail).toHaveBeenCalledTimes(1);

await act(async () => first.resolve(original));
await waitFor(() => expect(engine.renderThumbnail).toHaveBeenCalledTimes(2));
```

Also request the same filter twice and assert one render, then load a replacement photo while a thumbnail is pending and assert its stale result is not committed.

- [ ] **Step 2: Run the hook test and observe the burst behavior**

Run: `pnpm --filter @easypic/web-app test -- --run src/test/use-image-session.test.tsx`

Expected: FAIL because current `Promise.allSettled(filters.map(...))` submits every thumbnail at once.

- [ ] **Step 3: Replace the burst with a photo-scoped queue**

Add refs with explicit responsibilities:

```ts
const thumbnailGeneration = useRef(0);
const thumbnailQueue = useRef<PublicFilter[]>([]);
const thumbnailQueuedIds = useRef(new Set<string>());
const thumbnailRunning = useRef(false);
```

`requestThumbnails` appends only uncached, unloaded, and unqueued IDs. `pumpThumbnails` removes one item, awaits `engine.renderThumbnail`, commits only when generation and image ID still match, then starts the next item. Use functional `setThumbnails`/`setThumbnailLoading` updates so the queue never captures stale maps.

Increment `thumbnailGeneration`, clear the queue, and clear queued IDs during `load`, `reset`, and unmount. Remove the automatic all-filter `generateThumbnails` effect.

- [ ] **Step 4: Run hook tests, web tests, and typecheck**

Run: `pnpm --filter @easypic/web-app test && pnpm --filter @easypic/web-app typecheck`

Expected: all web-app unit tests PASS.

- [ ] **Step 5: Commit incremental thumbnails**

```bash
git add packages/web-app/src/hooks/use-image-session.ts packages/web-app/src/test/use-image-session.test.tsx
git commit -m "fix(web-app): schedule thumbnails incrementally"
```

### Task 4: Coalesce preview requests and retain strength input

**Files:**
- Modify: `packages/web-app/src/hooks/use-image-session.ts`
- Modify: `packages/web-app/src/components/editor-controls.tsx`
- Modify: `packages/web-app/src/test/use-image-session.test.tsx`
- Modify: `packages/web-app/src/test/app.test.tsx`

**Interfaces:**
- `selectFilter(filter): Promise<void>` resolves when that request commits or is superseded.
- `setIntensity(value)` immediately reflects the requested strength and queues the latest render.
- `selectedFilter`/`filteredPreview` remain the last committed pair; `pendingFilter` is requested state.

- [ ] **Step 1: Add RED tests for A → B → C coalescing**

Use deferred preview results and assert the engine sees A immediately, does not see B or C while A runs, then sees only C:

```tsx
act(() => void result.current.selectFilter(filters[0]));
act(() => void result.current.selectFilter(filters[1]));
act(() => void result.current.selectFilter(filters[2]));
expect(engine.renderPreview).toHaveBeenCalledTimes(2); // identity + A

await act(async () => first.resolve(older));
await waitFor(() => expect(engine.renderPreview).toHaveBeenCalledTimes(3));
expect(engine.renderPreview).toHaveBeenLastCalledWith(
  loaded,
  expect.anything(),
  1,
  expect.any(Number),
  expect.any(Object),
);
expect(result.current.pendingFilter?.id).toBe(filters[2].id);
```

Resolve C and assert C becomes selected, A never commits, `busy` becomes false, and B was never passed to the engine. Add a second test that calls `setIntensity(0.4)` while A is running and verifies the latest queued request uses `0.4` and the UI reports `40%` immediately.

- [ ] **Step 2: Run hook tests to establish RED**

Run: `pnpm --filter @easypic/web-app test -- --run src/test/use-image-session.test.tsx src/test/app.test.tsx`

Expected: FAIL because current code starts every preview and disables strength while busy.

- [ ] **Step 3: Introduce a latest-only preview loop**

Use an internal request shape:

```ts
interface PreviewRequest {
  filter: PublicFilter;
  intensity: number;
  resolve(): void;
}

const previewRunning = useRef(false);
const queuedPreview = useRef<PreviewRequest | null>(null);
const requestedFilterRef = useRef<PublicFilter | null>(null);
const requestedIntensityRef = useRef(1);
```

`queuePreview` replaces and resolves an older queued request. `runPreviewLoop` awaits one render at a time; if a newer request exists after the current render, discard the current result and immediately process the latest. Only the final successful request updates `filteredPreview`, committed refs, `selectedFilter`, `intensity`, and clears `pendingFilter`/`busy`.

On a final failure, restore the committed filter/intensity, keep prior pixels, set the render error, and clear pending state. Invalidation during load/reset/unmount resolves and removes queued work.

- [ ] **Step 4: Keep filter cards and strength input interactive during preview**

Change the strength slider from `disabled={busy}` to only disable when there is neither a committed nor pending filter. `setIntensity` updates requested state immediately and queues the current requested filter at the new strength. Export stays disabled through the existing busy guard.

- [ ] **Step 5: Run all web tests and typecheck**

Run: `pnpm --filter @easypic/web-app test && pnpm --filter @easypic/web-app typecheck`

Expected: all web-app tests PASS without an act warning or unresolved deferred promise.

- [ ] **Step 6: Commit preview coalescing**

```bash
git add packages/web-app/src/hooks/use-image-session.ts packages/web-app/src/components/editor-controls.tsx packages/web-app/src/test/use-image-session.test.tsx packages/web-app/src/test/app.test.tsx
git commit -m "fix(web-app): prioritize latest filter preview"
```

### Task 5: Prove the real first-selection workflow

**Files:**
- Modify: `packages/web-app/e2e/app.spec.ts`
- Modify if necessary: `packages/web-app/src/components/editor-shell.tsx`

**Interfaces:**
- Consumes: committed heading and pending status from Tasks 2-4.
- Produces: browser regression coverage for immediate interaction after first click.

- [ ] **Step 1: Tighten E2E completion semantics**

After clicking the first filter, first assert the pending announcement, immediately press `ArrowLeft` on the strength slider, then wait for both committed heading and `99%`:

```ts
await page.getByRole('button', { name: /Fuji Astia/ }).click();
await expect(page.getByRole('status')).toContainText('正在应用 Fuji Astia');
await page.getByRole('slider', { name: '滤镜强度' }).press('ArrowLeft');
await expect(page.getByRole('heading', { name: 'Fuji Astia' })).toBeVisible();
await expect(page.getByText('99%')).toBeVisible();
```

Add a multi-filter response and click A → B → C rapidly; assert only C becomes committed and the busy status disappears.

- [ ] **Step 2: Run the reproduction repeatedly**

Run: `pnpm --filter @easypic/web-app test:e2e -- --grep "uploads PNG|coalesces rapid" --project=desktop --repeat-each=5`

Expected: 10/10 repetitions PASS. This command previously reproduced the lost-input race.

- [ ] **Step 3: Run package and repository verification**

Run:

```bash
pnpm --filter @easypic/web-app test
pnpm --filter @easypic/web-app test:e2e
pnpm -r typecheck
pnpm -r build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Commit the browser regression**

```bash
git add packages/web-app/e2e/app.spec.ts packages/web-app/src/components/editor-shell.tsx
git commit -m "test(web-app): cover responsive first filter selection"
```
