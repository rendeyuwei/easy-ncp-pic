# EasyPic Web Editor Comparison and Responsiveness Design

**Date:** 2026-08-13

## 1. Goal

Correct the comparison direction to show the original photo on the left and the filtered photo on the right, and remove the long apparent freeze that can occur when the user selects the first filter after opening a photo.

The change must preserve local-only photo processing, the existing filter output, keyboard accessibility, and the current public API contract.

## 2. Confirmed Problems

### 2.1 Comparison direction

The current filtered overlay is clipped so that it occupies the left side. Although the labels match that implementation, the approved product behavior is:

- Left: original photo.
- Right: filtered photo.
- Moving the divider to the right increases the visible original area.
- `Home` shows 0% original and 100% filter.
- `End` shows 100% original and 0% filter.

### 2.2 First-filter delay

After a photo loads, the browser currently submits thumbnail work for every filter to the same FIFO Worker used for the main preview. The first user-selected preview waits behind that thumbnail queue. Rapid filter selections add more preview requests; stale results are ignored in React, but their Worker work is not cancelled.

The UI also exposes the selected filter title before its preview is ready and disables the strength control while rendering. This makes the page appear complete while immediate input is discarded.

## 3. Chosen Design

### 3.1 Comparison semantics

The original canvas remains the base layer. The filtered overlay is clipped from the left by the divider percentage:

```text
0%                    divider                    100%
|------ original ------|------ filtered ---------|
```

At a divider position of `p`, the filtered overlay uses a left inset of `p%`. Labels, `aria-valuetext`, pointer behavior, keyboard behavior, and tests all use the same definition: `p` is the visible original percentage.

When “按住看原图” is active, the filtered overlay is fully clipped and hidden from assistive technology. The divider and both side labels are absent until the control is released.

### 3.2 Work scheduling

Main-preview work has priority over thumbnail work.

- Thumbnail generation is incremental rather than submitting every filter in one `Promise.allSettled` burst.
- The currently visible category is generated first. Other categories are generated only when selected or when the Worker is otherwise idle.
- Only one thumbnail request is submitted at a time so a user preview can enter the queue between thumbnails.
- Already generated thumbnails remain cached by filter ID for the active photo.
- Loading another photo invalidates the previous thumbnail queue and releases stale image resources.

Preview selection uses latest-only coalescing:

- At most one preview is executing and one latest request is waiting.
- If the user selects A, B, then C while A is executing, B is discarded and C runs after A.
- A stale preview never commits pixels, selection state, errors, progress, or busy state.
- The interface does not claim a filter is applied until its pixels are committed.

No Worker protocol cancellation is introduced in this milestone. Coalescing prevents unbounded preview buildup, while incremental thumbnails ensure the running request is small. True cancellation can be added later if export or full-resolution workloads require it.

### 3.3 Interaction state

The editor distinguishes requested and committed state:

- A clicked filter receives a pending visual state and the page announces `正在应用 <name>…`.
- The heading and selected state change to the new filter when the preview succeeds.
- If rendering fails, the prior committed filter, strength, and pixels remain visible.
- Repeated filter clicks remain available while rendering so the latest choice can replace the pending choice.
- Strength changes made while a filter preview is pending are retained and applied to the latest requested filter; they are not silently dropped.
- Export remains disabled while the committed preview is changing.

## 4. Component Boundaries

- `PhotoCompare` owns only divider interaction and left/right presentation.
- `FilterBrowser` reports the active category and renders committed and pending selection states.
- `useImageSession` owns preview coalescing, committed/requested state, thumbnail scheduling, resource disposal, and progress.
- `WorkerEngine` remains the execution boundary; its protocol is unchanged unless implementation evidence shows that a small scheduling seam is necessary for deterministic tests.

The thumbnail scheduler should be a focused hook-local helper or small module with one responsibility: choose the next thumbnail ID after higher-priority preview work is clear.

## 5. Failure and Resource Rules

- Thumbnail failure affects only that thumbnail and results in “暂无预览”; it does not block filter selection.
- Preview failure preserves the last successfully rendered pixels and reports an actionable error.
- Photo reset or component unmount invalidates queued work. Any image handle returned after invalidation is disposed without recreating a Worker.
- Progress callbacks from stale work cannot change current UI state.
- Canvas fallback retains the same scheduling rules and comparison semantics.

## 6. Testing

Unit and integration coverage must verify:

- Left original/right filter clipping at 0%, 50%, and 100%.
- Pointer and keyboard movement change both the numeric value and the correct side of the clip.
- “按住看原图” hides the filtered layer, labels, and slider semantics.
- Thumbnail requests are incremental rather than submitted as one burst.
- A user preview can run between thumbnail requests.
- Rapid A → B → C selection renders A and C, never commits B, and does not leave `busy` stuck.
- Strength input during a pending selection is applied to the latest request.
- Failed or stale requests cannot replace committed state.
- The browser E2E waits for committed preview completion rather than treating a changed title as completion, and immediate first-selection interaction remains effective.

## 7. Acceptance Criteria

- The comparison view consistently shows original on the left and filter on the right.
- Selecting the first filter is not delayed behind all filter thumbnails.
- Rapid selection cannot create an unbounded Worker queue.
- User input during the first selection is not silently discarded.
- Existing local-only processing, export, fallback, and accessibility behavior remain intact.

## 8. Out of Scope

- Changing filter mathematics or visual output.
- Moving photo processing to the server.
- Full Worker task cancellation or multiple Worker pools.
- Full-resolution tiled export, which remains a separate specification gap.
