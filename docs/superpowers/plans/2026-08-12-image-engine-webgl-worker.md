# Image Engine WebGL / Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a browser-verified WebGL2 primary renderer, automatic Canvas 2D fallback, and a module-Web-Worker engine client that keeps preview, thumbnail, and export processing off the main thread.

**Architecture:** `createEngine` receives an `ImageRenderer`, preserving the existing synchronous Canvas renderer as its default. A reusable two-pass WebGL2 renderer implements the same curve → saturation/hue → monochrome/toning → sharpen → intensity chain, while a fallback renderer permanently switches to Canvas after WebGL creation, context-loss, or render failure. A typed worker protocol stores full-resolution images inside the worker and transfers only input bytes, rendered pixels, metadata, and encoded output across the boundary.

**Tech Stack:** TypeScript strict ESM, WebGL2/GLSL ES 3.00, OffscreenCanvas, module Web Workers, Vitest, Playwright Chromium, Vite 8.x, tsup, pnpm, Node.js 22.

## Global Constraints

- Use Node.js 22.20.0 and pnpm 9.12.1; every package command runs with the repository's Node 22 toolchain.
- Preserve the existing `createEngine(platform)` behavior: without an injected renderer it remains the Canvas reference path.
- WebGL is the browser primary path; Canvas 2D is the required automatic fallback.
- WebGL and Canvas consume the same `FilterParams` and match within maximum 3 RGBA byte values per channel and mean absolute error at most 0.5 on browser parity fixtures.
- The render order remains curve → saturation/hue → monochrome filter/toning → limited 3×3 unsharp mask → clamp → intensity blend.
- Worker messages use transferable `ArrayBuffer` values and never clone a `CurveLut` class instance directly.
- User image bytes and pixels never leave the browser; this package adds no network calls.
- Browser resources are explicitly released: textures, framebuffers, programs, workers, and stored image handles.
- Progress is monotonic per request and uses the stages `decode`, `scale`, `render`, and `encode`.
- This milestone does not add tiled export. Full-resolution export continues to use the existing engine path; tiled export and downscale recovery remain a separate memory-management milestone.

---

## File Structure

```text
packages/image-engine/
  src/
    curve.ts                    # expose a defensive LUT copy for GPU/worker serialization
    renderer.ts                 # renderer interface, Canvas adapter, and sticky fallback
    render-webgl.ts             # reusable two-pass WebGL2 renderer and GPU lifecycle
    webgl-shaders.ts            # GLSL ES 3.00 vertex/filter/final shaders
    webgl-params.ts             # FilterParams -> WebGL uniforms/LUT data
    engine.ts                   # accept an injectable ImageRenderer
    worker-protocol.ts          # serializable params and request/response unions
    worker-server.ts            # request dispatcher and image-handle store
    worker-client.ts            # public async WorkerEngine proxy
    worker-runtime.ts           # browser worker entrypoint
    index.ts                    # public exports (not worker-runtime side effects)
    tsup.config.ts              # index + worker-runtime build entries
  test/
    renderer.test.ts
    webgl-params.test.ts
    worker-protocol.test.ts
    worker-server.test.ts
    worker-client.test.ts
    browser/
      index.html
      harness.ts
      webgl-worker.spec.ts
  playwright.config.ts
```

---

### Task 0: LUT Serialization and Renderer Injection

**Files:**
- Modify: `packages/image-engine/src/curve.ts`
- Create: `packages/image-engine/src/renderer.ts`
- Modify: `packages/image-engine/src/engine.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/curve.test.ts`
- Test: `packages/image-engine/test/renderer.test.ts`
- Test: `packages/image-engine/test/engine.test.ts`

**Interfaces:**
- Produces: `CurveLut.toFloat32Array(): Float32Array`
- Produces: `ImageRenderer`, `canvasRenderer`, `createFallbackRenderer(primary, fallback, onFallback?)`
- Changes: `createEngine(platform: Platform, renderer?: ImageRenderer): Engine`

- [ ] **Step 1: Write failing tests for a defensive LUT copy and renderer injection**

Add to `curve.test.ts`:

```ts
it('returns a defensive Float32Array copy for GPU and worker transport', () => {
  const lut = CurveLut.identity();
  const values = lut.toFloat32Array();
  expect(values).toHaveLength(257);
  values[128] = 0;
  expect(lut.apply(0.5)).toBeCloseTo(0.5, 6);
});
```

Create `renderer.test.ts` with a 1×1 fixture and two fake renderers. Assert that `canvasRenderer` delegates to `renderCanvas`; assert that `createFallbackRenderer` uses its primary until the primary throws, calls `onFallback` once, and permanently uses the fallback afterward.

Add an `engine.test.ts` case that injects a renderer returning solid red pixels, calls `renderPreview`, and verifies that the injected renderer—not `renderCanvas`—produced the result.

- [ ] **Step 2: Run the focused tests and confirm the missing APIs fail**

Run:

```bash
pnpm --filter @easypic/image-engine test curve renderer engine
```

Expected: FAIL because `toFloat32Array`, `renderer.ts`, and the second `createEngine` parameter do not exist.

- [ ] **Step 3: Add the renderer boundary**

Add this public method to `CurveLut`:

```ts
toFloat32Array(): Float32Array {
  return this.values.slice();
}
```

Create `renderer.ts` around these exact interfaces:

```ts
import type { FilterParams } from './params';
import { renderCanvas, type RenderableImage } from './render-canvas';

export type RendererKind = 'canvas' | 'webgl';

export interface ImageRenderer {
  readonly kind: RendererKind;
  render(image: RenderableImage, params: FilterParams, intensity?: number): RenderableImage;
  dispose?(): void;
}

export const canvasRenderer: ImageRenderer = {
  kind: 'canvas',
  render: renderCanvas,
};

export function createFallbackRenderer(
  primary: ImageRenderer,
  fallback: ImageRenderer = canvasRenderer,
  onFallback?: (error: unknown) => void,
): ImageRenderer {
  let active = primary;
  let reported = false;
  return {
    get kind() { return active.kind; },
    render(image, params, intensity = 1) {
      try {
        return active.render(image, params, intensity);
      } catch (error) {
        if (active === fallback) throw error;
        active.dispose?.();
        active = fallback;
        if (!reported) {
          reported = true;
          onFallback?.(error);
        }
        return active.render(image, params, intensity);
      }
    },
    dispose() {
      primary.dispose?.();
      if (fallback !== primary) fallback.dispose?.();
    },
  };
}
```

Change `createEngine` to accept `renderer: ImageRenderer = canvasRenderer` and replace its direct `renderCanvas` call with `renderer.render`.

- [ ] **Step 4: Run focused and package tests**

Run:

```bash
pnpm --filter @easypic/image-engine test curve renderer engine
pnpm --filter @easypic/image-engine typecheck
```

Expected: all focused tests pass and TypeScript is clean.

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/curve.ts packages/image-engine/src/renderer.ts \
  packages/image-engine/src/engine.ts packages/image-engine/src/index.ts \
  packages/image-engine/test/curve.test.ts packages/image-engine/test/renderer.test.ts \
  packages/image-engine/test/engine.test.ts
git commit -m "refactor(image-engine): inject renderer into engine"
```

---

### Task 1: WebGL Parameter Packing

**Files:**
- Create: `packages/image-engine/src/webgl-params.ts`
- Test: `packages/image-engine/test/webgl-params.test.ts`

**Interfaces:**
- Consumes: `FilterParams`, `CurveLut.toFloat32Array()`
- Produces: `packWebGLParams(params, intensity): PackedWebGLParams`

- [ ] **Step 1: Write failing parameter-packing tests**

Test color and monochrome fixtures with these assertions:

```ts
expect(packWebGLParams(color, 2)).toMatchObject({
  monochrome: 0,
  saturation: color.saturation,
  hueDegrees: color.hue * 5,
  sharpeningAmount: color.sharpening * 0.15,
  intensity: 1,
  hasToning: 0,
});
expect(packWebGLParams(mono, -1)).toMatchObject({
  monochrome: 1,
  intensity: 0,
  hasToning: 1,
});
expect(packWebGLParams(mono, 1).curve).toHaveLength(257);
```

Also mutate the packed `curve` and assert the source `CurveLut` is unchanged.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @easypic/image-engine test webgl-params`

Expected: FAIL because `webgl-params.ts` does not exist.

- [ ] **Step 3: Implement packed parameters**

Use this exact shape:

```ts
export interface PackedWebGLParams {
  curve: Float32Array;
  saturation: number;
  hueDegrees: number;
  monochrome: 0 | 1;
  monoWeights: readonly [number, number, number];
  hasToning: 0 | 1;
  toningColor: readonly [number, number, number];
  toningMix: number;
  sharpeningAmount: number;
  intensity: number;
}
```

`toningMix` is `clamp01(strength * 0.1)`, default mono weights are `REC709`, and absent toning uses `[0, 0, 0]` with `hasToning: 0`.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @easypic/image-engine test webgl-params
pnpm --filter @easypic/image-engine typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/webgl-params.ts packages/image-engine/test/webgl-params.test.ts
git commit -m "feat(image-engine): pack filter params for WebGL"
```

---

### Task 2: Reusable WebGL2 Renderer and Automatic Canvas Fallback

**Files:**
- Create: `packages/image-engine/src/webgl-shaders.ts`
- Create: `packages/image-engine/src/render-webgl.ts`
- Modify: `packages/image-engine/src/index.ts`
- Modify: `packages/image-engine/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/image-engine/playwright.config.ts`
- Create: `packages/image-engine/test/browser/index.html`
- Create: `packages/image-engine/test/browser/harness.ts`
- Create: `packages/image-engine/test/browser/webgl-worker.spec.ts`

**Interfaces:**
- Consumes: `packWebGLParams`
- Produces: `FULLSCREEN_VERTEX_SHADER`, `FILTER_FRAGMENT_SHADER`, `FINAL_FRAGMENT_SHADER`
- Produces: `WebGLRenderer`, `createWebGLRenderer(options?)`, `createBrowserRenderer(options?)`
- Produces: browser parity harness callable as `window.easyPicHarness.runWebGLParity()`

- [ ] **Step 1: Add browser-test dependencies and scripts**

Run:

```bash
pnpm --filter @easypic/image-engine add -D @playwright/test@^1.54.0 vite@^8.0.0
```

Add scripts:

```json
"test:browser": "playwright test",
"test:all": "pnpm test && pnpm test:browser"
```

- [ ] **Step 2: Create the Playwright/Vite harness and write failing parity tests**

Configure Playwright to use Chromium, `test/browser/*.spec.ts`, base URL `http://127.0.0.1:4173`, and a Vite web server rooted at `packages/image-engine/test/browser`.

The harness must generate a deterministic 17×13 RGBA gradient with hard edges, load both NCP fixtures through browser-served fixture bytes, create color and monochrome `FilterParams`, and compare `renderCanvas` with `createWebGLRenderer().render` at intensities `0`, `0.5`, and `1`.

Return this serializable result:

```ts
interface ParityResult {
  webgl2: boolean;
  cases: Array<{ name: string; maxDelta: number; meanDelta: number }>;
}
```

The Playwright test asserts `webgl2 === true`, every `maxDelta <= 3`, and every `meanDelta <= 0.5`. Add a second harness action that injects a WebGL factory throwing `new Error('webgl disabled')`; assert `createBrowserRenderer` reports one fallback and matches `renderCanvas` exactly.

- [ ] **Step 3: Run the browser test and confirm failure**

Run:

```bash
pnpm --filter @easypic/image-engine test:browser
```

Expected: FAIL because `render-webgl.ts` and its exports do not exist. If Chromium is absent, run `pnpm --filter @easypic/image-engine exec playwright install chromium` and rerun.

- [ ] **Step 4: Implement GLSL sources, WebGL resource creation, and error reporting**

Create GLSL ES 3.00 sources after the browser test is red. The filter shader declares the input and 257×1 `R32F` curve samplers plus saturation, hue, monochrome weights, and toning uniforms. Use `texelFetch` and manually interpolate adjacent curve entries; port the existing REC709 saturation and RGB↔HSL hue formulas literally. The final shader reads filtered/original textures, clamps nine 3×3 neighbor coordinates to the image bounds, computes `detail = clamp(center - blur, -0.5, 0.5)`, adds the packed sharpening amount, clamps filtered RGB, then blends by clamped intensity. Preserve alpha in both passes.

`WebGLRenderer` owns one canvas/context, two programs, one VAO, the source/filtered/curve textures, and one framebuffer. Compile/link helpers include shader/program logs in thrown `WebGLRendererError` messages. Use WebGL2 only; request `{ alpha: true, antialias: false, depth: false, preserveDrawingBuffer: true }`.

Use these public factories:

```ts
export type WebGLCanvas = HTMLCanvasElement | OffscreenCanvas;
export type WebGLCanvasFactory = (width: number, height: number) => WebGLCanvas;

export interface WebGLRendererOptions {
  canvasFactory?: WebGLCanvasFactory;
}

export function createWebGLRenderer(options: WebGLRendererOptions = {}): ImageRenderer;

export function createBrowserRenderer(options: WebGLRendererOptions & {
  onFallback?: (error: unknown) => void;
} = {}): ImageRenderer;
```

The default factory uses `OffscreenCanvas` when available, otherwise `document.createElement('canvas')`; when neither exists it throws `WebGLRendererError('No browser canvas implementation is available')`. `createBrowserRenderer` catches creation failure and returns `canvasRenderer`; successful creation is wrapped in `createFallbackRenderer` so later context loss/render errors permanently select Canvas.

- [ ] **Step 5: Implement the two render passes**

For each render:

1. Resize the canvas and RGBA8 source/filtered textures to the input dimensions.
2. Upload input bytes with `UNPACK_ALIGNMENT = 1`, nearest filtering, and clamp-to-edge.
3. Upload the packed curve as a 257×1 `R32F` texture.
4. Draw the filter shader into the filtered texture attached to the framebuffer.
5. Bind the default framebuffer and draw the final sharpen/intensity shader.
6. Call `readPixels(0, 0, width, height, RGBA, UNSIGNED_BYTE, output)`.
7. Check `gl.getError()` after allocation and each pass; throw on non-`NO_ERROR`.

Register `webglcontextlost` where supported, call `preventDefault`, and mark the renderer unusable so its next render throws and activates the sticky Canvas fallback. `dispose()` deletes every owned GL resource and is idempotent.

- [ ] **Step 6: Run parity, package tests, and typecheck**

Run:

```bash
pnpm --filter @easypic/image-engine test:browser
pnpm --filter @easypic/image-engine test
pnpm --filter @easypic/image-engine typecheck
```

Expected: browser parity passes for color, monochrome, sharpening, and intensity; Node tests remain green.

- [ ] **Step 7: Commit**

```bash
git add packages/image-engine/src/render-webgl.ts packages/image-engine/src/index.ts \
  packages/image-engine/package.json packages/image-engine/playwright.config.ts \
  packages/image-engine/test/browser pnpm-lock.yaml
git commit -m "feat(image-engine): add WebGL2 renderer with Canvas fallback"
```

---

### Task 3: Serializable Worker Protocol

**Files:**
- Create: `packages/image-engine/src/worker-protocol.ts`
- Test: `packages/image-engine/test/worker-protocol.test.ts`

**Interfaces:**
- Produces: `SerializedFilterParams`, `serializeFilterParams`, `deserializeFilterParams`
- Produces: `WorkerRequest`, `WorkerResponse`, `WorkerProgress`, `WorkerFallback`, `WorkerLoadedImage`

- [ ] **Step 1: Write failing round-trip and message-shape tests**

Round-trip both NCP fixtures through `serializeFilterParams`/`deserializeFilterParams`. Assert every scalar/nested value is equal and compare all 257 curve samples. Assert the serialized value contains a `Float32Array` and no `CurveLut` instance.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @easypic/image-engine test worker-protocol`

Expected: FAIL because the protocol module does not exist.

- [ ] **Step 3: Define the protocol**

Use discriminated unions with these method names and payloads:

```ts
export type WorkerMethod = 'load' | 'preview' | 'thumbnail' | 'export' | 'dispose-image';
export type ProgressStage = 'decode' | 'scale' | 'render' | 'encode';

export interface WorkerLoadedImage {
  id: string;
  width: number;
  height: number;
  orientation: number;
  sourceFormat: 'image/jpeg' | 'image/png';
}

export type WorkerRequest =
  | { id: number; method: 'load'; bytes: Uint8Array }
  | { id: number; method: 'preview'; imageId: string; params: SerializedFilterParams; intensity: number; maxLongEdge: number }
  | { id: number; method: 'thumbnail'; imageId: string; params: SerializedFilterParams; size: number }
  | { id: number; method: 'export'; imageId: string; params: SerializedFilterParams; options: ExportOptions }
  | { id: number; method: 'dispose-image'; imageId: string };

export type WorkerResponse =
  | { id: number; ok: true; result: WorkerLoadedImage | PixelBuffer | Uint8Array | null }
  | { id: number; ok: false; error: { name: string; message: string } };

export interface WorkerProgress {
  id: number;
  event: 'progress';
  stage: ProgressStage;
  value: number;
}

export interface WorkerFallback {
  event: 'fallback';
  message: string;
}

export type WorkerInboundMessage = WorkerResponse | WorkerProgress | WorkerFallback;
```

`SerializedFilterParams` mirrors `FilterParams`, replacing `CurveLut` with `Float32Array`. Deserialization uses `CurveLut.from(Array.from(value.curve))`.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @easypic/image-engine test worker-protocol
pnpm --filter @easypic/image-engine typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/worker-protocol.ts packages/image-engine/test/worker-protocol.test.ts
git commit -m "feat(image-engine): define serializable worker protocol"
```

---

### Task 4: Worker Server and Image-Handle Lifecycle

**Files:**
- Create: `packages/image-engine/src/worker-server.ts`
- Test: `packages/image-engine/test/worker-server.test.ts`

**Interfaces:**
- Consumes: `createEngine`, `Platform`, `ImageRenderer`, worker protocol
- Produces: `createWorkerServer(options): WorkerServer`

- [ ] **Step 1: Write failing server tests with the Node platform**

Use the existing `nodeDecode`/`nodeEncode` test helper, `canvasRenderer`, and a collector callback. Verify:

- `load` returns metadata and stores the full `LoadedImage` under an opaque increasing ID.
- `preview` and `thumbnail` return `PixelBuffer` values with the requested bounds.
- `export` returns a decodable PNG with original dimensions.
- `dispose-image` removes the handle; a later preview returns a structured `Unknown image handle` error.
- progress values for every request are monotonic overall, start at `0`, end at `1`, and use only the allowed stages.
- thrown errors become `{ name, message }` responses without stack traces.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @easypic/image-engine test worker-server`

Expected: FAIL because `worker-server.ts` does not exist.

- [ ] **Step 3: Implement the request dispatcher**

Use this boundary:

```ts
export interface WorkerServerOptions {
  platform: Platform;
  renderer: ImageRenderer;
  post(message: WorkerResponse | WorkerProgress, transfer?: Transferable[]): void;
}

export interface WorkerServer {
  handle(request: WorkerRequest): Promise<void>;
  dispose(): void;
}
```

Keep `Map<string, LoadedImage>` private. Generate IDs as `image-1`, `image-2`, and so on. Emit overall request progress at these exact boundaries: load emits `decode` at `0` and `1`; preview/thumbnail emit `scale` at `0` and `0.4`, then `render` at `0.4` and `1`; export emits `render` at `0` and `0.7`, then `encode` at `0.7` and `1`; disposal emits no progress. Transfer `PixelBuffer.data.buffer` and exported `Uint8Array.buffer` in successful responses. `dispose()` clears images and disposes the renderer.

- [ ] **Step 4: Run focused tests, full Node tests, and typecheck**

Run:

```bash
pnpm --filter @easypic/image-engine test worker-server
pnpm --filter @easypic/image-engine test
pnpm --filter @easypic/image-engine typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/worker-server.ts packages/image-engine/test/worker-server.test.ts
git commit -m "feat(image-engine): add worker-side image engine server"
```

---

### Task 5: Worker Client

**Files:**
- Create: `packages/image-engine/src/worker-client.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/worker-client.test.ts`

**Interfaces:**
- Produces: `WorkerLike`, `WorkerEngine`, `createWorkerEngine(worker, options?)`, `createBrowserWorkerEngine(options?)`
- Consumes: worker protocol

- [ ] **Step 1: Write failing client tests with an in-memory fake Worker**

The fake records posted messages and transfer lists and can emit response/progress events. Verify concurrent requests resolve by numeric ID even when responses arrive out of order, progress routes only to the matching request callback, errors reject with the remote name/message, request buffers are transferred, `disposeImage` sends the correct handle, and `dispose()` rejects pending work then terminates the Worker once.

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @easypic/image-engine test worker-client`

Expected: FAIL because `worker-client.ts` does not exist.

- [ ] **Step 3: Implement the async public client**

Use these signatures:

```ts
export interface WorkerEngineOptions {
  onFallback?: (message: string) => void;
}

export interface WorkerCallOptions {
  onProgress?: (progress: { stage: ProgressStage; value: number }) => void;
}

export interface WorkerEngine {
  load(bytes: Uint8Array, call?: WorkerCallOptions): Promise<WorkerLoadedImage>;
  renderPreview(image: WorkerLoadedImage, params: FilterParams, intensity?: number, maxLongEdge?: number, call?: WorkerCallOptions): Promise<PixelBuffer>;
  renderThumbnail(image: WorkerLoadedImage, params: FilterParams, size?: number, call?: WorkerCallOptions): Promise<PixelBuffer>;
  exportImage(image: WorkerLoadedImage, params: FilterParams, options?: ExportOptions, call?: WorkerCallOptions): Promise<Uint8Array>;
  disposeImage(image: WorkerLoadedImage): Promise<void>;
  dispose(): void;
}
```

Clone caller-owned input bytes before transferring so `load` does not detach the caller's buffer. Serialize filter params per request. Validate response result types before resolving.

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
pnpm --filter @easypic/image-engine test worker-client worker-server worker-protocol
pnpm --filter @easypic/image-engine typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/worker-client.ts packages/image-engine/src/index.ts \
  packages/image-engine/test/worker-client.test.ts
git commit -m "feat(image-engine): add worker engine client"
```

---

### Task 6: Real Worker Browser E2E and Canvas Recovery

**Files:**
- Create: `packages/image-engine/src/worker-runtime.ts`
- Modify: `packages/image-engine/test/browser/harness.ts`
- Modify: `packages/image-engine/test/browser/webgl-worker.spec.ts`

**Interfaces:**
- Consumes: `createWorkerEngine`, source `worker-runtime.ts`, browser platform
- Verifies: real module Worker, OffscreenCanvas WebGL2, transferables, progress, export dimensions, fallback reporting

- [ ] **Step 1: Add a failing real-Worker browser scenario**

From the Vite harness create the client with:

```ts
createWorkerEngine(new Worker(
  new URL('../../src/worker-runtime.ts', import.meta.url),
  { type: 'module', name: 'easypic-browser-test' },
));
```

Generate a real 64×48 PNG in the browser, load it, render a 32px preview with a real NCP filter, export PNG, decode the export with `createImageBitmap`, and return metadata plus collected progress events. Assert preview bounds, exported 64×48 dimensions, monotonically completed progress, and changed filtered pixels.

- [ ] **Step 2: Run the real-Worker browser scenario and confirm the runtime is missing**

Run: `pnpm --filter @easypic/image-engine test:browser`

Expected: FAIL because `worker-runtime.ts` does not exist.

- [ ] **Step 3: Implement the real browser worker runtime**

At module load, create a browser renderer with an `onFallback` callback that posts `{ event: 'fallback', message }`, then create the worker server with `browserPlatform`. Route `self.addEventListener('message', event => void server.handle(event.data))`. Worker termination is owned by the client; terminating the worker releases its entire global scope and GPU resources.

Add `createBrowserWorkerEngine` beside the generic client; it constructs `new Worker(new URL('./worker-runtime.js', import.meta.url), { type: 'module', name: 'easypic-image-engine' })`. The main `index.ts` exports the client factory but never imports `worker-runtime.ts`, preventing worker side effects in normal consumers.

- [ ] **Step 4: Add and pass a forced-Canvas Worker scenario**

Add a test-only worker entry that creates the server with `canvasRenderer`. Run the same load → preview → export flow and assert byte-for-byte equality with the direct Canvas reference for preview pixels. This proves Worker correctness independently of WebGL availability.

- [ ] **Step 5: Run all browser and Node tests**

Run:

```bash
pnpm --filter @easypic/image-engine test:browser
pnpm --filter @easypic/image-engine test
pnpm --filter @easypic/image-engine typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/image-engine/test/browser
git commit -m "test(image-engine): verify WebGL worker and Canvas recovery in browser"
```

---

### Task 7: Multi-Entry Build and Consumer Smoke Test

**Files:**
- Modify: `packages/image-engine/tsup.config.ts`
- Modify: `packages/image-engine/package.json`
- Verify: `packages/image-engine/src/index.ts`

**Interfaces:**
- Produces: `dist/index.js`, `dist/index.d.ts`, `dist/worker-runtime.js`
- Guarantees: main entry has no worker side effects; browser client resolves the adjacent runtime asset

- [ ] **Step 1: Configure separate build entries**

Use named tsup entries:

```ts
entry: {
  index: 'src/index.ts',
  'worker-runtime': 'src/worker-runtime.ts',
},
```

Keep ESM, declarations, sourcemaps, `clean: true`, and target ES2022. Add `dist/worker-runtime.js` to the package files implicitly through the existing `dist` directory.

- [ ] **Step 2: Typecheck and build**

Run:

```bash
pnpm --filter @easypic/image-engine typecheck
pnpm --filter @easypic/image-engine build
```

Expected: `dist/index.js`, `dist/index.d.ts`, `dist/worker-runtime.js`, and sourcemaps are emitted.

- [ ] **Step 3: Verify entrypoint isolation and exports**

Run:

```bash
cd packages/image-engine
node --input-type=module -e "import { createEngine, createWebGLRenderer, createBrowserRenderer, createWorkerEngine, createBrowserWorkerEngine } from './dist/index.js'; console.log([createEngine, createWebGLRenderer, createBrowserRenderer, createWorkerEngine, createBrowserWorkerEngine].map(v => typeof v).join(' '));"
```

Expected: `function function function function function` and no access to `self`, `Worker`, or `OffscreenCanvas` occurs merely from importing the main entry.

Run:

```bash
rg -n "@napi-rs/canvas" dist/index.js dist/worker-runtime.js
```

Expected: no matches.

- [ ] **Step 4: Run package and browser suites against the final tree**

Run:

```bash
pnpm --filter @easypic/image-engine test
pnpm --filter @easypic/image-engine test:browser
pnpm --filter @easypic/image-engine typecheck
pnpm --filter @easypic/image-engine build
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/tsup.config.ts packages/image-engine/package.json packages/image-engine/src/index.ts pnpm-lock.yaml
git commit -m "build(image-engine): ship WebGL worker runtime"
```

---

### Task 8: Full-Repository Verification

**Files:**
- Verify only; no source changes expected.

**Interfaces:**
- Produces: a verified WebGL/Worker milestone ready for `web-app` integration.

- [ ] **Step 1: Run every workspace unit/integration test**

Run: `pnpm test`

Expected: all workspace suites pass with zero failures.

- [ ] **Step 2: Run image-engine browser acceptance tests**

Run: `pnpm --filter @easypic/image-engine test:browser`

Expected: WebGL parity, real Worker, and forced Canvas Worker cases pass in Chromium.

- [ ] **Step 3: Run final typecheck/build and inspect Git state**

Run:

```bash
pnpm --filter @easypic/image-engine typecheck
pnpm --filter @easypic/image-engine build
git status --short
```

Expected: typecheck/build pass; no `dist` files appear in Git status. Pre-existing `.superpowers/` and older untracked plan files remain untouched.

- [ ] **Step 4: Create the milestone commit if verification required tracked adjustments**

Only when Task 8 itself required a tracked correction:

```bash
git add packages/image-engine pnpm-lock.yaml
git commit -m "chore(image-engine): complete WebGL worker milestone"
```

If Task 8 made no tracked change, do not create an empty commit.

---

## Acceptance Checklist

- `createEngine(platform)` remains Canvas-backed and backward compatible.
- `createBrowserRenderer()` selects WebGL2 and permanently falls back to Canvas after failure.
- WebGL color and monochrome output stays within the declared Canvas byte tolerance.
- `createBrowserWorkerEngine()` performs load, preview, thumbnail, and export outside the main thread.
- Worker requests transfer buffers, preserve caller-owned input, route concurrent results correctly, and expose monotonic progress.
- Disposing image handles and engines releases CPU/GPU/Worker resources.
- Main package import is safe in Node and has no worker-runtime side effects.
- Browser and full workspace suites pass on the final tree.
