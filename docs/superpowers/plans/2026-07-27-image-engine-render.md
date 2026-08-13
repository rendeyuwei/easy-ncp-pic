# Image Engine (Render / IO — Canvas-first) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Canvas-first render/IO layer to `@easypic/image-engine`: EXIF orientation parsing + application, nearest-neighbor scaling, the Canvas 2D reference renderer, a platform abstraction (with a browser implementation), decode/encode (JPG q0.92 / PNG, preserve dimensions), and the public engine API (load → preview/thumbnail → export). All of it is headlessly testable via `@napi-rs/canvas`; WebGL + Web Worker come in a later, browser-verified plan.

**Architecture:** A `Platform` interface decouples pixel decode/encode from the environment — `browserPlatform` uses `createImageBitmap`/`OffscreenCanvas`/`convertToBlob`; tests inject a `nodePlatform` built on `@napi-rs/canvas`. The engine (`createEngine(platform)`) composes: `decode → assertWithinPixelLimits → parseExifOrientation → applyOrientationToBuffer → (scale → renderCanvas) → encode`. `renderCanvas` is the Canvas 2D **reference path**: it runs the already-tested `pipeline.process` on the pixels (the WebGL path added later must match it within a pixel tolerance, per §10.2). Orientation is applied explicitly from a parsed EXIF tag (pure pixel transform), so decode returns raw pixels in every environment.

**Tech Stack:** TypeScript (strict, ESM), Vitest, tsup; `@napi-rs/canvas` as a **devDependency** (tests only). Reuses the core (`pixel`, `params`, `pipeline`, `sizing`) built in the previous plan.

## Global Constraints

- Node 20.19+/22.12+; use the project's Node 22 (see Task 0). pnpm; commit the lockfile.
- Support `image/jpeg` and `image/png`; decode to sRGB pixels and correct EXIF orientation (spec §10.1).
- Default preview longest edge **2048px**, low-memory **1280px**; original-size metadata unchanged (spec §10.1). Reuse `computePreviewSize`.
- Reject images with any side **> 10000px** or total **> 80,000,000 px** before processing (spec §10.1). Reuse `assertWithinPixelLimits`.
- Export defaults to the input format (JPG→JPG, PNG→PNG), switchable; **JPG default quality 0.92** (and the download UI will show it) (spec §10.3). Preserve original pixel width/height; v1 does not preserve EXIF/GPS metadata (spec §10.3).
- The Canvas 2D path is the reference/fallback (spec §2 "Canvas 2D 回退"); WebGL is primary but is a LATER plan. Both must share the parameter model (§5.4) — already satisfied because `renderCanvas` consumes `FilterParams` + `pipeline.process`.
- Heavy work will run off the main thread via a Web Worker — a LATER plan; this plan keeps the engine synchronous/promise-based and Worker-agnostic.
- `@napi-rs/canvas` is a **devDependency only** (test double for the browser canvas). The library's runtime code must not import it; `browserPlatform` uses standard DOM APIs.
- EXIF orientation is applied explicitly from the parsed tag (so decode returns raw pixels identically in browser and Node); the browser decode must therefore yield raw (unoriented) pixels.

### Honest testability notes (this plan is Canvas-first by design)

- Everything here is testable headlessly **except `browserPlatform` itself** (it uses DOM APIs unavailable in Node). `browserPlatform` is thin, standard DOM code; it is typechecked + built here and exercised for real by the web-app's browser e2e tests (later plan). The engine, codec, EXIF, orientation, scale, and `renderCanvas` are all tested in Node via `nodePlatform`.
- WebGL rendering and the Web Worker are explicitly **deferred** to a later, browser-verified plan (per the agreed Canvas-first sequencing). The engine is designed so adding them is additive (a `renderWebGL` and a Worker wrapper around `pipeline.process`/`renderCanvas`).
- **EXIF orientation architecture (decided):** the *platform* delivers EXIF-ORIENTED pixels and the engine is orientation-agnostic (it does NOT re-apply orientation, which would double-rotate). `browserPlatform.decode` relies on the browser's automatic EXIF orientation at `createImageBitmap` decode (spec §10.1 "浏览器管理的 sRGB 像素并修正 EXIF 方向"); the Node test platform `nodeDecode` simulates this by parsing the EXIF orientation and applying `applyOrientationToBuffer`. `engine.load` reports the source EXIF orientation as metadata only. Browser e2e (later plan) must still verify orientation across Chrome/Safari/Firefox. (The earlier `imageOrientation: 'none'` idea was dropped: modern browsers ignore that option rather than throwing, so it would not yield raw pixels and would double-rotate.)

---

## File Structure

```
packages/image-engine/
  src/
    exif.ts                # parseExifOrientation(bytes): number (JPEG APP1/Exif + PNG eXIf)
    orientation.ts         # applyOrientationToBuffer(buf, orientation): PixelBuffer (pure)
    scale.ts               # scaleBuffer(buf, w, h): PixelBuffer (nearest-neighbor)
    render-canvas.ts       # renderCanvas(image, params, intensity): DecodedImage (reference path)
    platform.ts            # Platform interface + DecodedImage + browserPlatform (DOM)
    codec.ts               # decodeImage / encodeImage via a Platform; DEFAULT_JPEG_QUALITY
    engine.ts              # createEngine(platform): { load, renderPreview, renderThumbnail, exportImage }
    index.ts               # add the new exports
  test/
    helpers/node-platform.ts  # @napi-rs/canvas-backed Platform for tests
    exif.test.ts
    orientation.test.ts
    scale.test.ts
    render-canvas.test.ts
    codec.test.ts
    engine.test.ts
```

---

## Task 0: Add @napi-rs/canvas + Node platform test helper

**Files:**
- Modify: `packages/image-engine/package.json` (add `@napi-rs/canvas` devDependency)
- Create: `packages/image-engine/test/helpers/node-platform.ts`

**Interfaces:**
- Produces: `nodePlatform` (a `Platform` backed by `@napi-rs/canvas`) used by later tests. NOTE: the `Platform` type is defined in Task 5; for this task, define `nodePlatform` structurally and add the type import once `platform.ts` exists (Task 5). To avoid a forward dependency, this task creates `node-platform.ts` with its own local structural typing and Task 5 re-imports/aligns it. Simplest: create `node-platform.ts` now exporting the two functions `nodeDecode`/`nodeEncode`, and Task 6's `codec.test.ts`/`engine.test.ts` wrap them into a `Platform`. (Kept dependency-free of `platform.ts` so this task stands alone.)

**Environment — Node 22 required.** Prefix every node/pnpm command (same line):
```
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && <command>
```

- [ ] **Step 1: Add the devDependency**

Run:
```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine add -D @napi-rs/canvas@^1.0.0
```
Expected: succeeds (prebuilt binary; light). Confirm it loads:
```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && cd packages/image-engine && node --input-type=module -e "import {createCanvas} from '@napi-rs/canvas'; console.log(typeof createCanvas);"
```
Expected: `function`. If install fails (native build), report BLOCKED with the error.

- [ ] **Step 2: Write the Node platform helper**

`packages/image-engine/test/helpers/node-platform.ts`:
```ts
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { parseExifOrientation } from '../../src/exif';
import { applyOrientationToBuffer } from '../../src/orientation';
import { fromUint8Rgba, toUint8Rgba } from '../../src/pixel';

export interface DecodedPixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Decode image bytes to RGBA pixels, applying EXIF orientation to simulate the
 * browser's automatic orientation handling — so nodeDecode returns ORIENTED pixels
 * just like browserPlatform. The engine trusts the platform's oriented output and
 * does not re-apply orientation (avoids double-rotation; see the EXIF orientation
 * architecture note below).
 */
export async function nodeDecode(bytes: Uint8Array): Promise<DecodedPixels> {
  const img = await loadImage(Buffer.from(bytes));
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, img.width, img.height);
  const orientation = parseExifOrientation(bytes);
  const oriented = applyOrientationToBuffer(
    fromUint8Rgba(new Uint8ClampedArray(id.data), id.width, id.height),
    orientation,
  );
  return { data: toUint8Rgba(oriented), width: oriented.width, height: oriented.height };
}

/** Encode RGBA pixels to an image byte buffer. */
export async function nodeEncode(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  type: 'image/jpeg' | 'image/png',
  quality: number,
): Promise<Uint8Array> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const id = ctx.createImageData(width, height);
  id.data.set(rgba);
  ctx.putImageData(id, 0, 0);
  const buf = type === 'image/jpeg' ? canvas.toBuffer('image/jpeg', { quality }) : canvas.toBuffer('image/png');
  return new Uint8Array(buf);
}
```

- [ ] **Step 3: Add a tiny test to prove the helper round-trips**

`packages/image-engine/test/node-platform.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { nodeDecode, nodeEncode } from './helpers/node-platform';

describe('nodePlatform helper', () => {
  it('encodes then decodes RGBA preserving dimensions and (losslessly for PNG) pixels', async () => {
    const w = 2;
    const h = 1;
    const rgba = new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 255]);
    const png = await nodeEncode(rgba, w, h, 'image/png', 0.92);
    expect(png.length).toBeGreaterThan(0);
    const decoded = await nodeDecode(png);
    expect(decoded.width).toBe(w);
    expect(decoded.height).toBe(h);
    expect(Array.from(decoded.data)).toEqual(Array.from(rgba)); // PNG is lossless
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test node-platform`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/package.json pnpm-lock.yaml \
  packages/image-engine/test/helpers/node-platform.ts packages/image-engine/test/node-platform.test.ts
git commit -m "chore(image-engine): add @napi-rs/canvas test double for canvas decode/encode"
```

---

## Task 1: EXIF orientation parsing

**Files:**
- Create: `packages/image-engine/src/exif.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/exif.test.ts`

**Interfaces:**
- Produces: `parseExifOrientation(bytes: Uint8Array): number` — returns the EXIF orientation tag (1–8) for JPEG (APP1/Exif, both `II`/`MM` byte orders) and PNG (`eXIf` chunk); returns 1 when absent or unrecognized.

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/exif.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseExifOrientation } from '../src/exif';

/** Build a minimal JPEG carrying an EXIF orientation tag (big-endian "MM"). */
function jpegWithOrientation(orientation: number): Uint8Array {
  const tiff = new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", magic 42, IFD0 at offset 8
    0x00, 0x01, // 1 IFD entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // tag 0x0112 (orientation), type SHORT, count 1
    0x00, orientation, 0x00, 0x00, // value = orientation (big-endian short)
    0x00, 0x00, 0x00, 0x00, // next IFD = 0
  ]);
  const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segLen = exif.length + tiff.length + 2;
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff, // APP1 + length
    ...exif,
    ...tiff,
    0xff, 0xd9, // EOI
  ]);
}

/** Little-endian ("II") variant of the JPEG EXIF orientation fixture. */
function jpegWithOrientationLE(orientation: number): Uint8Array {
  const tiff = new Uint8Array([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II", magic 42 (LE), IFD0 at 8 (LE)
    0x01, 0x00, // 1 IFD entry (LE)
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x0112 (LE), SHORT (LE), count 1 (LE)
    orientation, 0x00, 0x00, 0x00, // value = orientation (LE short)
    0x00, 0x00, 0x00, 0x00, // next IFD = 0
  ]);
  const exif = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segLen = exif.length + tiff.length + 2;
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe1, (segLen >> 8) & 0xff, segLen & 0xff,
    ...exif,
    ...tiff,
    0xff, 0xd9,
  ]);
}

/** PNG carrying an eXIf chunk (big-endian "MM" TIFF block) with the orientation tag. */
function pngWithOrientation(orientation: number): Uint8Array {
  const tiff = new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08,
    0x00, 0x01,
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01,
    0x00, orientation, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const len = tiff.length;
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff, // eXIf chunk length (BE)
    0x65, 0x58, 0x49, 0x66, // "eXIf"
    ...tiff,
    0x00, 0x00, 0x00, 0x00, // CRC (not validated by the parser)
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00, // IEND
  ]);
}

describe('parseExifOrientation', () => {
  it('reads orientations 1..8 from a JPEG EXIF tag', () => {
    for (let o = 1; o <= 8; o++) {
      expect(parseExifOrientation(jpegWithOrientation(o))).toBe(o);
    }
  });

  it('returns 1 for a JPEG without an EXIF segment', () => {
    const noExif = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    expect(parseExifOrientation(noExif)).toBe(1);
  });

  it('returns 1 for non-image / empty input', () => {
    expect(parseExifOrientation(new Uint8Array([]))).toBe(1);
    expect(parseExifOrientation(new Uint8Array([0, 1, 2, 3]))).toBe(1);
  });

  it('returns 1 for a PNG without an eXIf chunk', () => {
    // Minimal PNG signature + IHDR-ish + IEND, no eXIf.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0x00, 0x00, 0x00, 0x00, // empty IEND chunk
    ]);
    expect(parseExifOrientation(png)).toBe(1);
  });

  it('reads orientations from a little-endian (II) JPEG EXIF tag', () => {
    for (let o = 1; o <= 8; o++) {
      expect(parseExifOrientation(jpegWithOrientationLE(o))).toBe(o);
    }
  });

  it('reads orientation from a PNG eXIf chunk', () => {
    expect(parseExifOrientation(pngWithOrientation(6))).toBe(6);
    expect(parseExifOrientation(pngWithOrientation(3))).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test exif`
Expected: FAIL — `Cannot find module '../src/exif'`.

- [ ] **Step 3: Write exif.ts**

```ts
function readU16(b: Uint8Array, off: number, le: boolean): number {
  return le ? b[off] | (b[off + 1] << 8) : (b[off] << 8) | b[off + 1];
}

function readU32(b: Uint8Array, off: number, le: boolean): number {
  return le
    ? (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0
    : ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

/** Parse the orientation tag from a TIFF/EXIF block starting at the byte-order mark. */
function parseTiffOrientation(t: Uint8Array): number {
  if (t.length < 8) return 1;
  const le = t[0] === 0x49 && t[1] === 0x49; // "II"
  const be = t[0] === 0x4d && t[1] === 0x4d; // "MM"
  if (!le && !be) return 1;
  if (readU16(t, 2, le) !== 0x002a) return 1;
  const ifdOffset = readU32(t, 4, le);
  if (ifdOffset + 2 > t.length) return 1;
  const count = readU16(t, ifdOffset, le);
  for (let i = 0; i < count; i++) {
    const entry = ifdOffset + 2 + i * 12;
    if (entry + 12 > t.length) break;
    const tag = readU16(t, entry, le);
    if (tag === 0x0112) {
      const type = readU16(t, entry + 2, le);
      const value = type === 3 ? readU16(t, entry + 8, le) : readU32(t, entry + 8, le);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** Return the EXIF orientation (1–8) of a JPEG or PNG, or 1 if none/unknown. */
export function parseExifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4) return 1;
  // JPEG: FF D8 ... scan segments for APP1 (FF E1) carrying "Exif\0\0".
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let off = 2;
    while (off + 4 < bytes.length) {
      if (bytes[off] !== 0xff) break;
      const marker = bytes[off + 1];
      const segLen = (bytes[off + 2] << 8) | bytes[off + 3];
      if (marker === 0xe1) {
        const data = off + 4;
        if (
          bytes[data] === 0x45 && bytes[data + 1] === 0x78 && bytes[data + 2] === 0x69 &&
          bytes[data + 3] === 0x66 && bytes[data + 4] === 0x00 && bytes[data + 5] === 0x00
        ) {
          return parseTiffOrientation(bytes.subarray(data + 6));
        }
      }
      if (marker === 0xda) break; // start of scan; no more metadata segments
      if (segLen < 2) break;
      off += 2 + segLen;
    }
    return 1;
  }
  // PNG: scan chunks for "eXIf" (its data is a TIFF/EXIF block).
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    let off = 8;
    while (off + 8 < bytes.length) {
      const len = readU32(bytes, off, false);
      const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
      if (type === 'eXIf') return parseTiffOrientation(bytes.subarray(off + 8, off + 8 + len));
      if (type === 'IEND') break;
      off += 12 + len;
    }
    return 1;
  }
  return 1;
}
```

In `src/index.ts`, add:
```ts
export * from './exif';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test exif`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/exif.ts packages/image-engine/src/index.ts packages/image-engine/test/exif.test.ts
git commit -m "feat(image-engine): parse EXIF orientation from JPEG/PNG bytes"
```

---

## Task 2: EXIF orientation application (pure pixel transform)

**Files:**
- Create: `packages/image-engine/src/orientation.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/orientation.test.ts`

**Interfaces:**
- Consumes: `PixelBuffer`, `createPixelBuffer`, `clonePixelBuffer`.
- Produces: `applyOrientationToBuffer(buf, orientation): PixelBuffer` — applies EXIF orientations 1–8 (rotations/flips), swapping dimensions for 5–8; orientation 1/unknown returns a clone.

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/orientation.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyOrientationToBuffer } from '../src/orientation';
import { createPixelBuffer } from '../src/pixel';

/** 2x1 image: pixel(0,0)=A, pixel(1,0)=B (distinct RGBA). */
function twoByOne(): ReturnType<typeof createPixelBuffer> {
  const buf = createPixelBuffer(2, 1);
  buf.data.set([1, 1, 1, 1, 2, 2, 2, 2]);
  return buf;
}
function px(buf: ReturnType<typeof createPixelBuffer>, x: number, y: number): number[] {
  const i = (y * buf.width + x) * 4;
  return Array.from(buf.data.slice(i, i + 4));
}

/** 3x2 image (non-square, to catch dimension-swap bugs) with 6 distinct pixels. */
function distinct3x2(): ReturnType<typeof createPixelBuffer> {
  const buf = createPixelBuffer(3, 2);
  for (let i = 0; i < 3 * 2; i++) {
    buf.data[i * 4] = i + 1;
    buf.data[i * 4 + 1] = i + 1;
    buf.data[i * 4 + 2] = i + 1;
    buf.data[i * 4 + 3] = 1;
  }
  return buf;
}

/** Inverse of each EXIF orientation (5/7 are self-inverse; 6<->8). */
const ORIENTATION_INVERSE: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 8, 7: 7, 8: 6 };

describe('applyOrientationToBuffer', () => {
  it('orientation 1 is the identity (a clone)', () => {
    const out = applyOrientationToBuffer(twoByOne(), 1);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(px(out, 0, 0)).toEqual([1, 1, 1, 1]);
    expect(px(out, 1, 0)).toEqual([2, 2, 2, 2]);
  });

  it('orientation 3 rotates 180 (dims unchanged, pixels swapped)', () => {
    const out = applyOrientationToBuffer(twoByOne(), 3);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect(px(out, 0, 0)).toEqual([2, 2, 2, 2]);
    expect(px(out, 1, 0)).toEqual([1, 1, 1, 1]);
  });

  it('orientation 2 mirrors horizontally', () => {
    const out = applyOrientationToBuffer(twoByOne(), 2);
    expect(px(out, 0, 0)).toEqual([2, 2, 2, 2]);
    expect(px(out, 1, 0)).toEqual([1, 1, 1, 1]);
  });

  it('orientation 6 rotates 90 CW and swaps dimensions (2x1 -> 1x2)', () => {
    const out = applyOrientationToBuffer(twoByOne(), 6);
    expect(out.width).toBe(1);
    expect(out.height).toBe(2);
    // 90 CW: left pixel (A) goes to top, right pixel (B) goes to bottom.
    expect(px(out, 0, 0)).toEqual([1, 1, 1, 1]);
    expect(px(out, 0, 1)).toEqual([2, 2, 2, 2]);
  });

  it('orientation 8 rotates 270 CW (90 CCW) and swaps dimensions', () => {
    const out = applyOrientationToBuffer(twoByOne(), 8);
    expect(out.width).toBe(1);
    expect(out.height).toBe(2);
    // 90 CCW: left pixel (A) goes to bottom, right pixel (B) goes to top.
    expect(px(out, 0, 0)).toEqual([2, 2, 2, 2]);
    expect(px(out, 0, 1)).toEqual([1, 1, 1, 1]);
  });

  it('unknown orientation (<1 or >8) behaves as identity', () => {
    const out = applyOrientationToBuffer(twoByOne(), 99);
    expect(px(out, 0, 0)).toEqual([1, 1, 1, 1]);
    expect(px(out, 1, 0)).toEqual([2, 2, 2, 2]);
  });

  it('every orientation is reversible: apply then its inverse restores the original (pins 4/5/7 too)', () => {
    const src = distinct3x2();
    const original = Array.from(src.data);
    for (let o = 1; o <= 8; o++) {
      const once = applyOrientationToBuffer(src, o);
      const back = applyOrientationToBuffer(once, ORIENTATION_INVERSE[o]);
      expect(back.width).toBe(src.width);
      expect(back.height).toBe(src.height);
      expect(Array.from(back.data)).toEqual(original);
    }
  });

  it('does not mutate the input buffer', () => {
    const src = distinct3x2();
    const before = Array.from(src.data);
    applyOrientationToBuffer(src, 6);
    expect(Array.from(src.data)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test orientation`
Expected: FAIL — `Cannot find module '../src/orientation'`.

- [ ] **Step 3: Write orientation.ts**

```ts
import type { PixelBuffer } from './pixel';
import { createPixelBuffer, clonePixelBuffer } from './pixel';

/**
 * Apply an EXIF orientation (1–8) to a pixel buffer, returning a new buffer.
 * Orientations 5–8 swap width/height. Orientation 1 / unknown returns a clone.
 */
export function applyOrientationToBuffer(buf: PixelBuffer, orientation: number): PixelBuffer {
  const o = orientation < 1 || orientation > 8 ? 1 : orientation;
  if (o === 1) return clonePixelBuffer(buf);

  const { width: W, height: H, data } = buf;
  const swap = o >= 5;
  const outW = swap ? H : W;
  const outH = swap ? W : H;
  const out = createPixelBuffer(outW, outH);

  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      let dx: number;
      let dy: number;
      switch (o) {
        case 2: dx = W - 1 - sx; dy = sy; break;          // mirror horizontal
        case 3: dx = W - 1 - sx; dy = H - 1 - sy; break;   // rotate 180
        case 4: dx = sx; dy = H - 1 - sy; break;           // mirror vertical
        case 5: dx = sy; dy = sx; break;                   // transpose
        case 6: dx = H - 1 - sy; dy = sx; break;           // rotate 90 CW
        case 7: dx = H - 1 - sy; dy = W - 1 - sx; break;   // transverse
        case 8: dx = sy; dy = W - 1 - sx; break;           // rotate 270 CW
        default: dx = sx; dy = sy;
      }
      const si = (sy * W + sx) * 4;
      const di = (dy * outW + dx) * 4;
      out.data[di] = data[si];
      out.data[di + 1] = data[si + 1];
      out.data[di + 2] = data[si + 2];
      out.data[di + 3] = data[si + 3];
    }
  }
  return out;
}
```

In `src/index.ts`, add:
```ts
export * from './orientation';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test orientation`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/orientation.ts packages/image-engine/src/index.ts packages/image-engine/test/orientation.test.ts
git commit -m "feat(image-engine): apply EXIF orientation as a pure pixel transform"
```

---

## Task 3: Nearest-neighbor scaling

**Files:**
- Create: `packages/image-engine/src/scale.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/scale.test.ts`

**Interfaces:**
- Consumes: `PixelBuffer`, `createPixelBuffer`, `clonePixelBuffer`.
- Produces: `scaleBuffer(buf, outW, outH): PixelBuffer` — nearest-neighbor resize (v1; documented). Same-size returns a clone.

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/scale.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { scaleBuffer } from '../src/scale';
import { createPixelBuffer } from '../src/pixel';

function checker2x2(): ReturnType<typeof createPixelBuffer> {
  const buf = createPixelBuffer(2, 2);
  buf.data.set([
    10, 10, 10, 1, 20, 20, 20, 1, // row 0
    30, 30, 30, 1, 40, 40, 40, 1, // row 1
  ]);
  return buf;
}
function px(buf: ReturnType<typeof createPixelBuffer>, x: number, y: number): number {
  return buf.data[(y * buf.width + x) * 4];
}

describe('scaleBuffer', () => {
  it('same size returns an equal clone (independent buffer)', () => {
    const src = checker2x2();
    const out = scaleBuffer(src, 2, 2);
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
    out.data[0] = 99;
    expect(src.data[0]).toBe(10);
  });

  it('upscales 2x2 -> 4x4 by repeating nearest pixels', () => {
    const out = scaleBuffer(checker2x2(), 4, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
    expect(px(out, 0, 0)).toBe(10); // top-left source
    expect(px(out, 3, 0)).toBe(20); // top-right source
    expect(px(out, 0, 3)).toBe(30); // bottom-left source
    expect(px(out, 3, 3)).toBe(40); // bottom-right source
  });

  it('downscales 2x2 -> 1x1 to the top-left pixel (nearest)', () => {
    const out = scaleBuffer(checker2x2(), 1, 1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(px(out, 0, 0)).toBe(10);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test scale`
Expected: FAIL — `Cannot find module '../src/scale'`.

- [ ] **Step 3: Write scale.ts**

```ts
import type { PixelBuffer } from './pixel';
import { createPixelBuffer, clonePixelBuffer } from './pixel';

/**
 * Nearest-neighbor resize (v1). Adequate for previews/thumbnails; a higher-quality
 * resampler can replace this later without changing the interface.
 */
export function scaleBuffer(buf: PixelBuffer, outW: number, outH: number): PixelBuffer {
  if (outW === buf.width && outH === buf.height) return clonePixelBuffer(buf);
  const out = createPixelBuffer(outW, outH);
  const xRatio = buf.width / outW;
  const yRatio = buf.height / outH;
  for (let y = 0; y < outH; y++) {
    const sy = Math.min(buf.height - 1, Math.floor(y * yRatio));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(buf.width - 1, Math.floor(x * xRatio));
      const si = (sy * buf.width + sx) * 4;
      const di = (y * outW + x) * 4;
      out.data[di] = buf.data[si];
      out.data[di + 1] = buf.data[si + 1];
      out.data[di + 2] = buf.data[si + 2];
      out.data[di + 3] = buf.data[si + 3];
    }
  }
  return out;
}
```

In `src/index.ts`, add:
```ts
export * from './scale';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test scale`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/scale.ts packages/image-engine/src/index.ts packages/image-engine/test/scale.test.ts
git commit -m "feat(image-engine): add nearest-neighbor scaling"
```

---

## Task 4: Canvas 2D reference renderer

**Files:**
- Create: `packages/image-engine/src/render-canvas.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/render-canvas.test.ts`

**Interfaces:**
- Consumes: `FilterParams`, `fromUint8Rgba`/`toUint8Rgba`, `pipeline.process`; a `DecodedImage`-shaped `{ data, width, height }`.
- Produces: `renderCanvas(image, params, intensity?): { data: Uint8ClampedArray; width; height }` — the Canvas 2D reference path (runs `pipeline.process` on the pixels). This is the path the later WebGL renderer must match within a pixel tolerance (§10.2).

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/render-canvas.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { renderCanvas } from '../src/render-canvas';
import { fromParsedPictureControl } from '../src/params';

const here = dirname(fileURLToPath(import.meta.url));
const astia = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')))),
);

function grayImage(w: number, h: number, v: number) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

describe('renderCanvas (reference path)', () => {
  it('preserves dimensions', () => {
    const out = renderCanvas(grayImage(8, 6, 128), astia, 1);
    expect(out.width).toBe(8);
    expect(out.height).toBe(6);
    expect(out.data.length).toBe(8 * 6 * 4);
  });

  it('changes pixels when a real filter is applied at full intensity', () => {
    const input = grayImage(4, 4, 128);
    const out = renderCanvas(input, astia, 1);
    // A real curve/filter should move at least some pixels off the input value.
    const changed = Array.from(out.data).some((v, i) => v !== input.data[i]);
    expect(changed).toBe(true);
  });

  it('intensity 0 returns the input unchanged', () => {
    const input = grayImage(4, 4, 128);
    const out = renderCanvas(input, astia, 0);
    expect(Array.from(out.data)).toEqual(Array.from(input.data));
  });

  it('output is within [0,255]', () => {
    const out = renderCanvas(grayImage(4, 4, 200), astia, 1);
    for (const v of out.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test render-canvas`
Expected: FAIL — `Cannot find module '../src/render-canvas'`.

- [ ] **Step 3: Write render-canvas.ts**

```ts
import type { FilterParams } from './params';
import { fromUint8Rgba, toUint8Rgba } from './pixel';
import { process } from './pipeline';

export interface RenderableImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Canvas 2D reference path: applies the full filter pipeline to the image's pixels.
 * The WebGL renderer (later plan) must match this within a pixel tolerance (spec §10.2).
 */
export function renderCanvas(image: RenderableImage, params: FilterParams, intensity: number = 1): RenderableImage {
  const input = fromUint8Rgba(image.data, image.width, image.height);
  const out = process(input, params, intensity);
  return { data: toUint8Rgba(out), width: out.width, height: out.height };
}
```

In `src/index.ts`, add:
```ts
export * from './render-canvas';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test render-canvas`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/render-canvas.ts packages/image-engine/src/index.ts packages/image-engine/test/render-canvas.test.ts
git commit -m "feat(image-engine): add Canvas 2D reference renderer"
```

---

## Task 5: Platform abstraction + browser platform

**Files:**
- Create: `packages/image-engine/src/platform.ts`
- Modify: `packages/image-engine/src/index.ts`

**Interfaces:**
- Produces: `DecodedImage { data: Uint8ClampedArray; width; height }`; `EncodeParams { type; quality }`; `Platform { decode(bytes): Promise<DecodedImage>; encode(rgba, w, h, params): Promise<Uint8Array> }`; `browserPlatform` (DOM implementation: `createImageBitmap`/`OffscreenCanvas`/`convertToBlob`).
- Note: `browserPlatform` uses DOM APIs unavailable in Node, so it has NO Node unit test; it is typechecked + built here and exercised by the web-app's browser e2e (later plan). The engine/codec are tested via the Node platform helper.

- [ ] **Step 1: Write platform.ts**

```ts
export interface DecodedImage {
  data: Uint8ClampedArray; // RGBA
  width: number;
  height: number;
}

export interface EncodeParams {
  type: 'image/jpeg' | 'image/png';
  quality: number;
}

/** Environment abstraction for pixel decode/encode. */
export interface Platform {
  decode(bytes: Uint8Array): Promise<DecodedImage>;
  encode(rgba: Uint8ClampedArray, width: number, height: number, params: EncodeParams): Promise<Uint8Array>;
}

/**
 * Browser implementation. Decodes to RAW pixels (EXIF orientation is applied
 * explicitly by the engine), so behavior matches the Node test platform.
 * NOTE: only runs in a browser (uses DOM APIs); verified by browser e2e tests.
 */
export const browserPlatform: Platform = {
  async decode(bytes: Uint8Array): Promise<DecodedImage> {
    // Browsers apply EXIF orientation automatically at decode (spec §10.1: browser-managed
    // sRGB pixels with EXIF orientation corrected). The engine trusts this oriented output
    // and does NOT re-apply orientation (that would double-rotate). The Node test platform
    // simulates this by applying the parsed EXIF orientation inside nodeDecode.
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.drawImage(bitmap, 0, 0);
    const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close();
    return { data: id.data, width: id.width, height: id.height };
  },
  async encode(rgba: Uint8ClampedArray, width: number, height: number, params: EncodeParams): Promise<Uint8Array> {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: params.type, quality: params.quality });
    return new Uint8Array(await blob.arrayBuffer());
  },
};
```

In `src/index.ts`, add:
```ts
export * from './platform';
```

- [ ] **Step 2: Typecheck (browserPlatform uses DOM lib types; ensure the DOM lib is available to tsc)**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine typecheck`
Expected: clean. If DOM types (`OffscreenCanvas`, `createImageBitmap`, `ImageData`) are not found, the tsconfig needs `"lib": ["ES2022", "DOM"]` — add `"lib": ["ES2022", "DOM"]` to `packages/image-engine/tsconfig.json` `compilerOptions` and re-run. (The package targets the browser, so the DOM lib is appropriate.)

- [ ] **Step 3: Verify the suite still passes (no runtime test for browserPlatform)**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test`
Expected: all existing tests pass (browserPlatform is not imported by any Node test).

- [ ] **Step 4: Commit**

```bash
git add packages/image-engine/src/platform.ts packages/image-engine/src/index.ts packages/image-engine/tsconfig.json
git commit -m "feat(image-engine): add Platform abstraction and browser implementation"
```

---

## Task 6: Decode / encode via a Platform

**Files:**
- Create: `packages/image-engine/src/codec.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/codec.test.ts`

**Interfaces:**
- Consumes: `Platform`, `DecodedImage`, the Node platform helper (`nodeDecode`/`nodeEncode`).
- Produces: `DEFAULT_JPEG_QUALITY = 0.92`; `decodeImage(bytes, platform)`; `encodeImage(rgba, w, h, opts, platform)` with `EncodeOptions { type?; quality? }` (type default `image/jpeg`, quality default 0.92).

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/codec.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { decodeImage, encodeImage, detectImageFormat, DEFAULT_JPEG_QUALITY } from '../src/codec';
import type { Platform } from '../src/platform';
import { nodeDecode, nodeEncode } from './helpers/node-platform';

const nodePlatform: Platform = {
  decode: (b) => nodeDecode(b),
  encode: (rgba, w, h, p) => nodeEncode(rgba, w, h, p.type, p.quality),
};

const rgba = new Uint8ClampedArray([200, 100, 50, 255, 10, 20, 30, 255]); // 2x1

describe('codec', () => {
  it('DEFAULT_JPEG_QUALITY is 0.92', () => {
    expect(DEFAULT_JPEG_QUALITY).toBe(0.92);
  });

  it('detectImageFormat distinguishes PNG from JPEG', () => {
    expect(detectImageFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('image/png');
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(detectImageFormat(new Uint8Array([]))).toBe('image/jpeg');
  });

  it('encode (PNG) then decode round-trips dimensions and pixels losslessly', async () => {
    const png = await encodeImage(rgba, 2, 1, { type: 'image/png' }, nodePlatform);
    const decoded = await decodeImage(png, nodePlatform);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.data)).toEqual(Array.from(rgba));
  });

  it('defaults to JPEG when type is omitted', async () => {
    const bytes = await encodeImage(rgba, 2, 1, {}, nodePlatform);
    // JPEG SOI marker.
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  });

  it('JPEG encode is decodable and preserves dimensions', async () => {
    const bytes = await encodeImage(rgba, 2, 1, { type: 'image/jpeg', quality: 0.92 }, nodePlatform);
    const decoded = await decodeImage(bytes, nodePlatform);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test codec`
Expected: FAIL — `Cannot find module '../src/codec'`.

- [ ] **Step 3: Write codec.ts**

```ts
import type { Platform, DecodedImage } from './platform';

export const DEFAULT_JPEG_QUALITY = 0.92;

export interface EncodeOptions {
  type?: 'image/jpeg' | 'image/png';
  quality?: number;
}

export async function decodeImage(bytes: Uint8Array, platform: Platform): Promise<DecodedImage> {
  return platform.decode(bytes);
}

export async function encodeImage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  opts: EncodeOptions,
  platform: Platform,
): Promise<Uint8Array> {
  const type = opts.type ?? 'image/jpeg';
  const quality = opts.quality ?? DEFAULT_JPEG_QUALITY;
  return platform.encode(rgba, width, height, { type, quality });
}

/** Detect the image format from the magic bytes (defaults to JPEG). */
export function detectImageFormat(bytes: Uint8Array): 'image/jpeg' | 'image/png' {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  return 'image/jpeg';
}
```

In `src/index.ts`, add:
```ts
export * from './codec';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test codec`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/codec.ts packages/image-engine/src/index.ts packages/image-engine/test/codec.test.ts
git commit -m "feat(image-engine): add decode/encode via platform (JPEG q0.92 default)"
```

---

## Task 7: Engine API (load → preview/thumbnail → export)

**Files:**
- Create: `packages/image-engine/src/engine.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/engine.test.ts`

**Interfaces:**
- Consumes: `Platform`, `decodeImage`/`encodeImage`/`detectImageFormat`/`EncodeOptions`/`DEFAULT_JPEG_QUALITY`, `parseExifOrientation`, `applyOrientationToBuffer`, `fromUint8Rgba`/`toUint8Rgba`/`PixelBuffer`, `scaleBuffer`, `renderCanvas`, `computePreviewSize`, `assertWithinPixelLimits`, `FilterParams`.
- Produces: `LoadedImage { buffer: PixelBuffer; width; height; orientation; sourceFormat }`; `Engine { load(bytes); renderPreview(image, params, intensity?, maxLongEdge?); renderThumbnail(image, params, size?); exportImage(image, params, opts?) }`; `createEngine(platform): Engine`. `exportImage` defaults the output format to the loaded image's `sourceFormat` (spec §10.3 "默认沿用输入格式").

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/engine.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { createEngine, type Engine } from '../src/engine';
import type { Platform } from '../src/platform';
import { fromParsedPictureControl } from '../src/params';
import { nodeDecode, nodeEncode } from './helpers/node-platform';

const here = dirname(fileURLToPath(import.meta.url));
const astia = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')))),
);

const nodePlatform: Platform = {
  decode: (b) => nodeDecode(b),
  encode: (rgba, w, h, p) => nodeEncode(rgba, w, h, p.type, p.quality),
};

/** Make a real encoded test image (solid-ish colors) via the node platform. */
async function makeTestImage(w: number, h: number, type: 'image/jpeg' | 'image/png'): Promise<Uint8Array> {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      rgba[i] = (x * 255) / Math.max(1, w - 1);
      rgba[i + 1] = (y * 255) / Math.max(1, h - 1);
      rgba[i + 2] = 128;
      rgba[i + 3] = 255;
    }
  }
  return nodeEncode(rgba, w, h, type, 0.92);
}

let engine: Engine;
beforeAll(() => {
  engine = createEngine(nodePlatform);
});

describe('engine', () => {
  it('load decodes and reports dimensions', async () => {
    const img = await makeTestImage(40, 30, 'image/png');
    const loaded = await engine.load(img);
    expect(loaded.width).toBe(40);
    expect(loaded.height).toBe(30);
    expect(loaded.orientation).toBe(1); // generated image has no EXIF
  });

  it('renderPreview scales to the requested long edge and applies the filter', async () => {
    const loaded = await engine.load(await makeTestImage(400, 200, 'image/png'));
    const preview = engine.renderPreview(loaded, astia, 1, 100);
    expect(preview.width).toBe(100);
    expect(preview.height).toBe(50);
  });

  it('renderThumbnail produces a small image', async () => {
    const loaded = await engine.load(await makeTestImage(400, 200, 'image/png'));
    const thumb = engine.renderThumbnail(loaded, astia, 32);
    expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(32);
  });

  it('exportImage preserves the original pixel dimensions (PNG)', async () => {
    const loaded = await engine.load(await makeTestImage(60, 40, 'image/png'));
    const out = await engine.exportImage(loaded, astia, { type: 'image/png' });
    const decoded = await nodeDecode(out);
    expect(decoded.width).toBe(60);
    expect(decoded.height).toBe(40);
  });

  it('exportImage defaults to the input format (JPEG in -> JPEG out)', async () => {
    const loaded = await engine.load(await makeTestImage(20, 20, 'image/jpeg'));
    const out = await engine.exportImage(loaded, astia, {});
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0xd8);
  });

  it('exportImage defaults to the input format (PNG in -> PNG out)', async () => {
    const loaded = await engine.load(await makeTestImage(20, 20, 'image/png'));
    const out = await engine.exportImage(loaded, astia, {});
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50); // 'P'
  });

  it('exported pixels differ from the input when a filter is applied', async () => {
    const bytes = await makeTestImage(30, 30, 'image/png');
    const loaded = await engine.load(bytes);
    const out = await engine.exportImage(loaded, astia, { type: 'image/png' });
    const before = await nodeDecode(bytes);
    const after = await nodeDecode(out);
    const differs = Array.from(after.data).some((v, i) => Math.abs(v - before.data[i]) > 2);
    expect(differs).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test engine`
Expected: FAIL — `Cannot find module '../src/engine'`.

- [ ] **Step 3: Write engine.ts**

```ts
import type { Platform } from './platform';
import type { FilterParams } from './params';
import type { PixelBuffer } from './pixel';
import { fromUint8Rgba, toUint8Rgba } from './pixel';
import { parseExifOrientation } from './exif';
import { scaleBuffer } from './scale';
import { renderCanvas } from './render-canvas';
import { decodeImage, encodeImage, detectImageFormat, DEFAULT_JPEG_QUALITY, type EncodeOptions } from './codec';
import { assertWithinPixelLimits, computePreviewSize, DEFAULT_PREVIEW_LONG_EDGE } from './sizing';

export interface LoadedImage {
  buffer: PixelBuffer; // oriented, full resolution
  width: number;
  height: number;
  orientation: number;
  sourceFormat: 'image/jpeg' | 'image/png';
}

export interface ExportOptions extends EncodeOptions {
  intensity?: number;
}

export interface Engine {
  load(bytes: Uint8Array): Promise<LoadedImage>;
  renderPreview(image: LoadedImage, params: FilterParams, intensity?: number, maxLongEdge?: number): PixelBuffer;
  renderThumbnail(image: LoadedImage, params: FilterParams, size?: number): PixelBuffer;
  exportImage(image: LoadedImage, params: FilterParams, opts?: ExportOptions): Promise<Uint8Array>;
}

export function createEngine(platform: Platform): Engine {
  function renderBuffer(buffer: PixelBuffer, params: FilterParams, intensity: number): PixelBuffer {
    const rendered = renderCanvas({ data: toUint8Rgba(buffer), width: buffer.width, height: buffer.height }, params, intensity);
    return fromUint8Rgba(rendered.data, rendered.width, rendered.height);
  }

  return {
    async load(bytes: Uint8Array): Promise<LoadedImage> {
      // The platform delivers EXIF-ORIENTED pixels (browser auto-orients at decode; the
      // Node test platform simulates it in nodeDecode). The engine does NOT re-apply
      // orientation (that would double-rotate). `orientation` is source metadata only.
      const decoded = await decodeImage(bytes, platform);
      assertWithinPixelLimits(decoded.width, decoded.height);
      const orientation = parseExifOrientation(bytes);
      const sourceFormat = detectImageFormat(bytes);
      const buffer = fromUint8Rgba(decoded.data, decoded.width, decoded.height);
      return { buffer, width: decoded.width, height: decoded.height, orientation, sourceFormat };
    },

    renderPreview(image, params, intensity = 1, maxLongEdge = DEFAULT_PREVIEW_LONG_EDGE): PixelBuffer {
      const sized = computePreviewSize(image.width, image.height, maxLongEdge);
      const scaled = scaleBuffer(image.buffer, sized.width, sized.height);
      return renderBuffer(scaled, params, intensity);
    },

    renderThumbnail(image, params, size = 96): PixelBuffer {
      const sized = computePreviewSize(image.width, image.height, size);
      const scaled = scaleBuffer(image.buffer, sized.width, sized.height);
      return renderBuffer(scaled, params, 1);
    },

    async exportImage(image, params, opts = {}): Promise<Uint8Array> {
      const rendered = renderBuffer(image.buffer, params, opts.intensity ?? 1);
      const type = opts.type ?? image.sourceFormat; // default follows the input format (spec §10.3)
      const quality = opts.quality ?? DEFAULT_JPEG_QUALITY;
      return encodeImage(toUint8Rgba(rendered), rendered.width, rendered.height, { type, quality }, platform);
    },
  };
}
```

In `src/index.ts`, add:
```ts
export * from './engine';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test engine`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/engine.ts packages/image-engine/src/index.ts packages/image-engine/test/engine.test.ts
git commit -m "feat(image-engine): add engine API (load, preview, thumbnail, export)"
```

---

## Task 8: Build, exports, and final verification (render/IO)

**Files:**
- Verify: `packages/image-engine/tsup.config.ts`, `package.json`, `src/index.ts` exports.

**Interfaces:**
- Produces: a consumable ESM build exposing the render/IO additions (`createEngine`, `browserPlatform`, `renderCanvas`, `parseExifOrientation`, `applyOrientationToBuffer`, `scaleBuffer`, codec helpers) alongside the core.

- [ ] **Step 1: Typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine typecheck`
Expected: clean.

- [ ] **Step 2: Build**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine build`
Expected: tsup emits `dist/index.js` + `dist/index.d.ts` (+ sourcemap). `@napi-rs/canvas` must NOT be bundled (it is a devDependency; only the test helper imports it, and `src/` does not). Confirm no `@napi-rs/canvas` reference appears in `dist/index.js`.

- [ ] **Step 3: Smoke-test the built library as a consumer**

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && cd packages/image-engine && node --input-type=module -e "import { createEngine, renderCanvas, parseExifOrientation, applyOrientationToBuffer, scaleBuffer, DEFAULT_JPEG_QUALITY } from './dist/index.js'; console.log(typeof createEngine, typeof renderCanvas, typeof parseExifOrientation, DEFAULT_JPEG_QUALITY);"
```
Expected: `function function function 0.92`.

- [ ] **Step 4: Run the full suite and confirm dist is ignored**

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test
git status --short   # nothing under packages/image-engine/dist
```
Expected: all image-engine tests pass; `git status` shows nothing under `packages/image-engine/dist`.

- [ ] **Step 5: Milestone commit**

```bash
git commit --allow-empty -m "chore(image-engine): v0.2.0 Canvas-first render/IO complete (engine, codec, EXIF, orientation, scale)"
```

---

## Out of scope for this plan (next plan: image-engine render/WebGL/Worker)

- **WebGL renderer** (primary path, GLSL shaders implementing the same chain sharing `FilterParams`) + the **pixel-tolerance parity test** vs `renderCanvas` (§10.2). Requires a GL context; browser/headless-gl verified.
- **Web Worker** wrapper running `pipeline.process`/`renderCanvas` off the main thread, with progress events (§2, §13.4 "预览处理不长期阻塞主线程").
- Tiled export for very large images (§10.3) and the "offer downscale/JPG without clearing edit state" recovery.
- All of the above are additive: `renderWebGL` and a Worker wrap the `FilterParams` + `pipeline.process`/`renderCanvas` delivered here. The Canvas path shipped here is the spec's required fallback and is fully tested.
