# Image Engine (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, fully-unit-tested filter-math core of `@easypic/image-engine`: the shared parameter model and the per-pixel pipeline (curve LUT, color/monochrome conversion, monochrome filter & toning, saturation & hue, sharpening, intensity blend) plus input sizing/limits/orientation geometry — no DOM/GPU, runnable and testable in Node.

**Architecture:** Pixels are `PixelBuffer { width, height, data: Float32Array }` in RGBA, float [0,1] (spec §10.2: float intermediates, clamp at output). `fromParsedPictureControl` turns a parser `ParsedPictureControl` into a renderer-agnostic `FilterParams` (the single shared parameter model, spec §5.4). Each transform is a small pure module; `pipeline.process(input, params, intensity)` composes them in the spec §10.2 order. A later plan adds the Canvas/WebGL renderers, decode/encode, and worker on top of this core — they will consume `FilterParams` + `pipeline` unchanged.

**Tech Stack:** TypeScript (strict, ESM), Vitest, tsup; workspace dep `@easypic/ncp-parser` (for the `ParsedPictureControl` type and to load the verified NCP fixtures in tests). No browser/DOM/GPU here.

## Global Constraints

- Node.js **20.19+** / **22.12+**; use the project's Node 22 (see Task 0 environment note). pnpm; commit the lockfile (spec §2).
- Preview and export MUST share one parameter model and (later) one shader/pixel logic so the two paths cannot diverge (spec §5.4). This plan delivers that shared model (`FilterParams`) and the reference per-pixel implementation (`pipeline`).
- The 257-point curve is used as a 257-entry lookup table (with interpolation) — **never compressed to fewer control points** (spec §10.2).
- Color mode applies the **same master curve to R, G, B**; intermediates are float, **clamped only at final output** (spec §10.2).
- Monochrome mode uses **explicit, testable luminance weights**, then applies filter and toning (spec §10.2).
- Sharpening is a **limited Unsharp Mask**; strength maps from the NCP sharpening value and **halo is limited** (spec §10.2).
- The intensity slider blends **original ↔ fully-filtered**, default 100% (spec §10.2).
- Filter pipeline order is exactly: input sRGB → base color/mono mode → 257-point NCP curve → saturation & hue → monochrome filter & toning (if present) → sharpening → blend with original by intensity → (encode, later plan) (spec §10.2).
- Input normalization geometry: default preview longest edge **2048px**, low-memory **1280px** (original-size metadata unchanged); **reject** images with any side **> 10000px** or total **> 80,000,000 px** (decompression-bomb guard) (spec §10.1).
- This project does **not** promise pixel-exact parity with Nikon hardware (spec §1.2). The color-science mappings below (saturation/hue scale, monochrome filter weights, toning colors, sharpening amount) are **explicit, documented, testable approximations** — the tests pin THESE definitions.

### Design decisions (locked by this plan)

- **Pixel format:** RGBA float [0,1] in a `Float32Array` of length `width*height*4`.
- **Saturation:** `factor = 1 + saturation*0.1` (NCP `saturation` is 0x80-centered, e.g. −3..+3 → factor 0.7..1.3; 0 → no change). Applied as `out = luma + (channel − luma) * factor`.
- **Hue:** `degrees = hue * 5` (NCP `hue` centered → ±~15°); applied as an HSL hue rotation.
- **Monochrome luminance weights** (per filter code; default Rec.709): None `0x80`=[0.2126,0.7152,0.0722], Yellow `0x81`=[0.33,0.60,0.07], Orange `0x82`=[0.50,0.45,0.05], Red `0x83`=[0.70,0.30,0.00], Green `0x84`=[0.10,0.80,0.10], Blue `0x85`=[0.00,0.30,0.70].
- **Toning** (per toning code → tint RGB; mixed into grayscale by `strengthFactor = clamp(strength*0.1, 0, 1)`): Sepia `0x81`=[0.76,0.60,0.42], Cyan `0x82`=[0.50,0.70,0.70], Magenta `0x83`=[0.70,0.50,0.70], Yellow `0x84`=[0.70,0.70,0.50], Green `0x85`=[0.50,0.70,0.50], Blue `0x86`=[0.50,0.50,0.70].
- **Sharpening:** 3×3 Unsharp Mask, `amount = sharpening * 0.15`, detail clamped to `±0.5` to limit halos.
- **Monochrome conversion happens at the "黑白滤色与调色" stage** (after curve and saturation/hue), matching the literal §10.2 arrow order: curve and sat/hue act on RGB, then the image is collapsed to grayscale using the filter weights and tinted by toning. For color pictures that stage is a no-op.

---

## File Structure

```
packages/image-engine/
  package.json                       # deps: @easypic/ncp-parser (workspace)
  tsconfig.json
  tsup.config.ts
  src/
    index.ts                         # public exports of the core
    pixel.ts                         # PixelBuffer type + create/clone/fromUint8/toUint8
    params.ts                        # FilterParams + fromParsedPictureControl
    curve.ts                         # CurveLut (257-entry, interpolated apply)
    color.ts                         # luminance weights, clamp01, hsl helpers
    mono.ts                          # monochrome filter weights + toning colors + application
    adjust.ts                        # saturation + hue
    sharpen.ts                       # limited unsharp mask
    blend.ts                         # intensity blend (original ↔ filtered)
    pipeline.ts                      # process(): compose the §10.2 chain
    sizing.ts                        # preview sizing, pixel-limit guard, EXIF orientation geometry
  test/
    pixel.test.ts
    params.test.ts
    curve.test.ts
    color.test.ts
    mono.test.ts
    adjust.test.ts
    sharpen.test.ts
    blend.test.ts
    pipeline.test.ts
    sizing.test.ts
```

The two verified fixtures live in the sibling parser package and are read by tests via `../ncp-parser/test/fixtures/PICCON02.NCP` (relative to `packages/image-engine/test/`): PICCON02 = "Fuji Astia", Neutral (color), sharpening 2, saturation 0, hue 0, custom curve enabled; PICCON33 = "SHING TokugawaTone2", Monochrome, sharpening 2, filter 0x83, toning 0x84, strength 2.

---

## Task 0: Package scaffold + PixelBuffer + smoke test

**Files:**
- Create: `packages/image-engine/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/image-engine/src/pixel.ts`, `src/index.ts` (stub export), `test/pixel.test.ts`

**Interfaces:**
- Produces: `PixelBuffer { width: number; height: number; data: Float32Array }`; `createPixelBuffer(width, height): PixelBuffer` (zero-filled RGBA); `clonePixelBuffer(buf): PixelBuffer`; `fromUint8Rgba(data: Uint8ClampedArray | Uint8Array, width, height): PixelBuffer` (0..255 → 0..1); `toUint8Rgba(buf): Uint8ClampedArray` (0..1 → clamped 0..255).

**Environment — Node 22 required.** Prefix every node/pnpm command (same line):
```
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && <command>
```

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@easypic/image-engine",
  "version": "0.1.0",
  "type": "module",
  "description": "EasyPic image processing engine: shared filter parameter model and pixel pipeline.",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=20.19.0 <21 || >=22.12.0" },
  "dependencies": {
    "@easypic/ncp-parser": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json and tsup.config.ts**

`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "test"]
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
```

- [ ] **Step 3: Write the failing pixel test**

`packages/image-engine/test/pixel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createPixelBuffer, clonePixelBuffer, fromUint8Rgba, toUint8Rgba } from '../src/pixel';

describe('PixelBuffer', () => {
  it('createPixelBuffer makes a zero-filled RGBA buffer of width*height*4', () => {
    const buf = createPixelBuffer(2, 3);
    expect(buf.width).toBe(2);
    expect(buf.height).toBe(3);
    expect(buf.data).toBeInstanceOf(Float32Array);
    expect(buf.data.length).toBe(2 * 3 * 4);
    expect(buf.data.every((v) => v === 0)).toBe(true);
  });

  it('clonePixelBuffer copies data independently', () => {
    const a = createPixelBuffer(1, 1);
    a.data[0] = 0.5;
    const b = clonePixelBuffer(a);
    b.data[0] = 0.9;
    expect(a.data[0]).toBe(0.5);
    expect(b.data[0]).toBeCloseTo(0.9, 5); // Float32Array cannot store 0.9 exactly
  });

  it('fromUint8Rgba maps 0..255 to 0..1', () => {
    const buf = fromUint8Rgba(new Uint8ClampedArray([0, 128, 255, 255]), 1, 1);
    expect(buf.data[0]).toBeCloseTo(0, 5);
    expect(buf.data[1]).toBeCloseTo(128 / 255, 5);
    expect(buf.data[2]).toBeCloseTo(1, 5);
    expect(buf.data[3]).toBeCloseTo(1, 5);
  });

  it('toUint8Rgba clamps 0..1 back to 0..255', () => {
    const buf = createPixelBuffer(1, 1);
    buf.data.set([1.5, -0.2, 0.5, 1]); // out-of-range on purpose
    const out = toUint8Rgba(buf);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(128);
    expect(out[3]).toBe(255);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm install && pnpm --filter @easypic/image-engine test pixel`
Expected: FAIL — `Cannot find module '../src/pixel'`.

- [ ] **Step 5: Write pixel.ts and index.ts**

`packages/image-engine/src/pixel.ts`:
```ts
/** RGBA pixels in a Float32Array, each channel in [0,1] (intermediates may exceed; clamp at output). */
export interface PixelBuffer {
  width: number;
  height: number;
  data: Float32Array; // length = width * height * 4
}

export function createPixelBuffer(width: number, height: number): PixelBuffer {
  return { width, height, data: new Float32Array(width * height * 4) };
}

export function clonePixelBuffer(buf: PixelBuffer): PixelBuffer {
  return { width: buf.width, height: buf.height, data: buf.data.slice() };
}

export function fromUint8Rgba(data: Uint8ClampedArray | Uint8Array, width: number, height: number): PixelBuffer {
  const out = new Float32Array(width * height * 4);
  for (let i = 0; i < out.length; i++) out[i] = data[i] / 255;
  return { width, height, data: out };
}

export function toUint8Rgba(buf: PixelBuffer): Uint8ClampedArray {
  const out = new Uint8ClampedArray(buf.data.length);
  for (let i = 0; i < buf.data.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, buf.data[i])) * 255);
  return out;
}
```

`packages/image-engine/src/index.ts`:
```ts
export * from './pixel';
```

- [ ] **Step 6: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test pixel`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/image-engine pnpm-lock.yaml
git commit -m "chore: scaffold @easypic/image-engine with PixelBuffer core type"
```

---

## Task 1: 257-point curve LUT

**Files:**
- Create: `packages/image-engine/src/curve.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/curve.test.ts`

**Interfaces:**
- Produces: `CurveLut` with `CurveLut.from(lut257: readonly number[]): CurveLut`, `CurveLut.identity(): CurveLut`, and `.apply(v: number): number` (v in [0,1] → interpolated LUT value). The LUT always holds exactly 257 entries (§10.2).

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/curve.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { CurveLut } from '../src/curve';

describe('CurveLut', () => {
  it('identity maps every value to itself', () => {
    const lut = CurveLut.identity();
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(lut.apply(v)).toBeCloseTo(v, 6);
    }
  });

  it('from() keeps exactly 257 entries and reads endpoints', () => {
    const values = Array.from({ length: 257 }, (_, i) => i / 256); // identity ramp
    const lut = CurveLut.from(values);
    expect(lut.size).toBe(257);
    expect(lut.apply(0)).toBeCloseTo(0, 6);
    expect(lut.apply(1)).toBeCloseTo(1, 6);
  });

  it('interpolates between entries', () => {
    // LUT that doubles: y = 2x (clamped to 1). Entry i => min(1, 2*i/256).
    const values = Array.from({ length: 257 }, (_, i) => Math.min(1, (2 * i) / 256));
    const lut = CurveLut.from(values);
    // At v=0.25 (index 64), y = 0.5; at v=0.125 (index 32), y = 0.25.
    expect(lut.apply(0.25)).toBeCloseTo(0.5, 5);
    expect(lut.apply(0.125)).toBeCloseTo(0.25, 5);
    // Mid-segment (index 64.5, frac 0.5): blend of lut[64]=0.5 and lut[65]=130/256.
    expect(lut.apply(0.25 + 0.5 / 256)).toBeCloseTo((0.5 + 130 / 256) / 2, 5);
  });

  it('clamps out-of-range input to [0,1]', () => {
    const lut = CurveLut.identity();
    expect(lut.apply(-0.5)).toBeCloseTo(0, 6);
    expect(lut.apply(1.5)).toBeCloseTo(1, 6);
  });

  it('throws if the input is not 257 entries', () => {
    expect(() => CurveLut.from([0, 1])).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test curve`
Expected: FAIL — `Cannot find module '../src/curve'`.

- [ ] **Step 3: Write curve.ts**

```ts
const LUT_SIZE = 257;

/** A 257-entry lookup table mapping input [0,1] -> output [0,1] with linear interpolation. */
export class CurveLut {
  private constructor(readonly size: number, private readonly values: Float32Array) {}

  static from(lut257: readonly number[]): CurveLut {
    if (lut257.length !== LUT_SIZE) {
      throw new Error(`Curve LUT must have exactly ${LUT_SIZE} entries, got ${lut257.length}`);
    }
    return new CurveLut(LUT_SIZE, Float32Array.from(lut257));
  }

  static identity(): CurveLut {
    const values = new Float32Array(LUT_SIZE);
    for (let i = 0; i < LUT_SIZE; i++) values[i] = i / (LUT_SIZE - 1);
    return new CurveLut(LUT_SIZE, values);
  }

  /** Map v (clamped to [0,1]) through the LUT with linear interpolation. */
  apply(v: number): number {
    const x = Math.min(1, Math.max(0, v)) * (LUT_SIZE - 1);
    const i = Math.floor(x);
    if (i >= LUT_SIZE - 1) return this.values[LUT_SIZE - 1];
    const frac = x - i;
    return this.values[i] * (1 - frac) + this.values[i + 1] * frac;
  }
}
```

In `src/index.ts`, add:
```ts
export * from './curve';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test curve`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/curve.ts packages/image-engine/src/index.ts packages/image-engine/test/curve.test.ts
git commit -m "feat(image-engine): add 257-point interpolated curve LUT"
```

---

## Task 2: Color helpers (luminance, clamp, HSL)

**Files:**
- Create: `packages/image-engine/src/color.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/color.test.ts`

**Interfaces:**
- Produces: `REC709: readonly [number, number, number]`; `luminance(r, g, b, weights?): number`; `clamp01(v): number`; `rgbToHsl(r,g,b): [h,s,l]` and `hslToRgb(h,s,l): [r,g,b]` (all channels 0..1, hue 0..1).

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/color.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { REC709, luminance, clamp01, rgbToHsl, hslToRgb } from '../src/color';

describe('color', () => {
  it('luminance uses Rec.709 weights by default and sums to 1 for white', () => {
    expect(luminance(1, 1, 1)).toBeCloseTo(1, 6);
    expect(luminance(1, 0, 0)).toBeCloseTo(REC709[0], 6);
    expect(luminance(0, 1, 0)).toBeCloseTo(REC709[1], 6);
    expect(luminance(0, 0, 1)).toBeCloseTo(REC709[2], 6);
  });

  it('luminance honors custom weights', () => {
    expect(luminance(1, 0, 0, [0.5, 0.3, 0.2])).toBeCloseTo(0.5, 6);
  });

  it('clamp01 clamps to [0,1]', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
  });

  it('rgb<->hsl round-trips primary colors', () => {
    for (const [r, g, b] of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0.5], [1, 1, 1]] as const) {
      const [h, s, l] = rgbToHsl(r, g, b);
      const [r2, g2, b2] = hslToRgb(h, s, l);
      expect(r2).toBeCloseTo(r, 5);
      expect(g2).toBeCloseTo(g, 5);
      expect(b2).toBeCloseTo(b, 5);
    }
  });

  it('hslToRgb rotates hue correctly (pure red hue=0)', () => {
    const [r, g, b] = hslToRgb(0, 1, 0.5);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test color`
Expected: FAIL — `Cannot find module '../src/color'`.

- [ ] **Step 3: Write color.ts**

```ts
export const REC709: readonly [number, number, number] = [0.2126, 0.7152, 0.0722];

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function luminance(r: number, g: number, b: number, weights: readonly [number, number, number] = REC709): number {
  return weights[0] * r + weights[1] * g + weights[2] * b;
}

/** RGB (each 0..1) -> HSL (h 0..1, s 0..1, l 0..1). */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

/** HSL (h 0..1, s 0..1, l 0..1) -> RGB (each 0..1). */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}
```

In `src/index.ts`, add:
```ts
export * from './color';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test color`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/color.ts packages/image-engine/src/index.ts packages/image-engine/test/color.test.ts
git commit -m "feat(image-engine): add color helpers (Rec.709 luminance, clamp, HSL)"
```

---

## Task 3: Monochrome filter weights + toning

**Files:**
- Create: `packages/image-engine/src/mono.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/mono.test.ts`

**Interfaces:**
- Produces: `MONO_FILTER_WEIGHTS: Readonly<Record<number, readonly [number, number, number]>>` (keyed by NCP filter code); `TONING_COLORS: Readonly<Record<number, readonly [number, number, number]>>` (keyed by NCP toning code); `monoToGray(r, g, b, weights): number`; `filterWeightsFor(code): [number,number,number]` (defaults to Rec.709 for unknown/None); `toningColorFor(code): [number,number,number] | null`; `applyToning(gray, color, strength): [r,g,b]`.

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/mono.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MONO_FILTER_WEIGHTS, TONING_COLORS, monoToGray, filterWeightsFor, toningColorFor, applyToning } from '../src/mono';
import { REC709 } from '../src/color';

describe('mono', () => {
  it('defines Rec.709 weights for None (0x80)', () => {
    expect(MONO_FILTER_WEIGHTS[0x80]).toEqual(REC709);
  });

  it('defines a red filter (0x83) that emphasizes red', () => {
    const w = MONO_FILTER_WEIGHTS[0x83];
    expect(w[0]).toBeGreaterThan(w[1]);
    expect(w[0]).toBeGreaterThan(w[2]);
  });

  it('filterWeightsFor falls back to Rec.709 for unknown codes', () => {
    expect(filterWeightsFor(0x00)).toEqual(REC709);
  });

  it('monoToGray computes the weighted sum', () => {
    expect(monoToGray(1, 1, 1, REC709)).toBeCloseTo(1, 6);
    expect(monoToGray(1, 0, 0, [0.5, 0.3, 0.2])).toBeCloseTo(0.5, 6);
  });

  it('toningColorFor returns colors for known codes and null for None/unknown', () => {
    expect(toningColorFor(0x81)).toEqual(TONING_COLORS[0x81]); // Sepia
    expect(toningColorFor(0x80)).toBeNull();
    expect(toningColorFor(0x00)).toBeNull();
  });

  it('applyToning with strength 0 leaves gray unchanged', () => {
    const [r, g, b] = applyToning(0.5, [0.76, 0.6, 0.42], 0);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });

  it('applyToning tints gray toward the toning color as strength grows', () => {
    const weak = applyToning(0.5, [1, 0, 0], 1);
    const strong = applyToning(0.5, [1, 0, 0], 5);
    expect(strong[0]).toBeGreaterThan(weak[0]); // more red
    expect(strong[1]).toBeLessThan(weak[1]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test mono`
Expected: FAIL — `Cannot find module '../src/mono'`.

- [ ] **Step 3: Write mono.ts**

```ts
import { REC709 } from './color';

/**
 * Monochrome filter-effect channel weights, keyed by NCP filter code (0x80-centered enum).
 * Documented, testable approximations (spec §10.2 "明确、可测试的亮度权重"); not Nikon-exact (spec §1.2).
 */
export const MONO_FILTER_WEIGHTS: Readonly<Record<number, readonly [number, number, number]>> = {
  0x80: REC709, // None
  0x81: [0.33, 0.6, 0.07], // Yellow
  0x82: [0.5, 0.45, 0.05], // Orange
  0x83: [0.7, 0.3, 0.0], // Red
  0x84: [0.1, 0.8, 0.1], // Green
  0x85: [0.0, 0.3, 0.7], // Blue
};

/** Toning tint colors, keyed by NCP toning code. 0x80 = None (no tint). Documented approximations. */
export const TONING_COLORS: Readonly<Record<number, readonly [number, number, number]>> = {
  0x81: [0.76, 0.6, 0.42], // Sepia
  0x82: [0.5, 0.7, 0.7], // Cyan
  0x83: [0.7, 0.5, 0.7], // Magenta
  0x84: [0.7, 0.7, 0.5], // Yellow
  0x85: [0.5, 0.7, 0.5], // Green
  0x86: [0.5, 0.5, 0.7], // Blue
};

export function filterWeightsFor(code: number): readonly [number, number, number] {
  return MONO_FILTER_WEIGHTS[code] ?? REC709;
}

export function toningColorFor(code: number): readonly [number, number, number] | null {
  return TONING_COLORS[code] ?? null;
}

export function monoToGray(r: number, g: number, b: number, weights: readonly [number, number, number]): number {
  return weights[0] * r + weights[1] * g + weights[2] * b;
}

/** Tint a grayscale value toward `color`, scaled by strength (NCP toning strength, 0..~3 => t 0..0.3). */
export function applyToning(
  gray: number,
  color: readonly [number, number, number],
  strength: number,
): [number, number, number] {
  const t = Math.min(1, Math.max(0, strength * 0.1));
  return [gray * (1 - t) + color[0] * t, gray * (1 - t) + color[1] * t, gray * (1 - t) + color[2] * t];
}
```

In `src/index.ts`, add:
```ts
export * from './mono';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test mono`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/mono.ts packages/image-engine/src/index.ts packages/image-engine/test/mono.test.ts
git commit -m "feat(image-engine): add monochrome filter weights and toning"
```

---

## Task 4: Saturation & hue

**Files:**
- Create: `packages/image-engine/src/adjust.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/adjust.test.ts`

**Interfaces:**
- Produces: `applySaturation(r, g, b, amount): [r,g,b]` where `factor = 1 + amount*0.1`; `applyHue(r, g, b, amount): [r,g,b]` where `degrees = amount*5` (HSL hue rotation).

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/adjust.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applySaturation, applyHue } from '../src/adjust';

describe('applySaturation', () => {
  it('amount 0 leaves color unchanged', () => {
    const [r, g, b] = applySaturation(0.8, 0.4, 0.2, 0);
    expect(r).toBeCloseTo(0.8, 6);
    expect(g).toBeCloseTo(0.4, 6);
    expect(b).toBeCloseTo(0.2, 6);
  });

  it('positive amount increases spread from luminance', () => {
    const [r, g, b] = applySaturation(0.8, 0.4, 0.2, 3);
    expect(r).toBeGreaterThan(0.8);
    expect(b).toBeLessThan(0.2);
  });

  it('amount -10 collapses to grayscale (all channels = luminance)', () => {
    const [r, g, b] = applySaturation(0.8, 0.4, 0.2, -10);
    expect(r).toBeCloseTo(g, 5);
    expect(g).toBeCloseTo(b, 5);
  });

  it('gray is unaffected by saturation', () => {
    const [r, g, b] = applySaturation(0.5, 0.5, 0.5, 5);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });
});

describe('applyHue', () => {
  it('amount 0 leaves color unchanged', () => {
    const [r, g, b] = applyHue(0.8, 0.4, 0.2, 0);
    expect(r).toBeCloseTo(0.8, 5);
    expect(g).toBeCloseTo(0.4, 5);
    expect(b).toBeCloseTo(0.2, 5);
  });

  it('a full 360 rotation (amount 72) returns to the same color', () => {
    const [r, g, b] = applyHue(0.8, 0.4, 0.2, 72);
    expect(r).toBeCloseTo(0.8, 4);
    expect(g).toBeCloseTo(0.4, 4);
    expect(b).toBeCloseTo(0.2, 4);
  });

  it('gray is unaffected by hue', () => {
    const [r, g, b] = applyHue(0.5, 0.5, 0.5, 20);
    expect(r).toBeCloseTo(0.5, 6);
    expect(g).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test adjust`
Expected: FAIL — `Cannot find module '../src/adjust'`.

- [ ] **Step 3: Write adjust.ts**

```ts
import { luminance, rgbToHsl, hslToRgb } from './color';

/** Saturation: amount is the NCP value (0x80-centered). factor = 1 + amount*0.1 (0 => no change). */
export function applySaturation(r: number, g: number, b: number, amount: number): [number, number, number] {
  const factor = 1 + amount * 0.1;
  const luma = luminance(r, g, b);
  return [luma + (r - luma) * factor, luma + (g - luma) * factor, luma + (b - luma) * factor];
}

/** Hue rotation: amount is the NCP value (0x80-centered). degrees = amount*5. */
export function applyHue(r: number, g: number, b: number, amount: number): [number, number, number] {
  const degrees = amount * 5;
  if (degrees === 0) return [r, g, b];
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s === 0) return [r, g, b]; // gray has no hue
  const h2 = (h + degrees / 360) % 1;
  return hslToRgb(h2 < 0 ? h2 + 1 : h2, s, l);
}
```

In `src/index.ts`, add:
```ts
export * from './adjust';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test adjust`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/adjust.ts packages/image-engine/src/index.ts packages/image-engine/test/adjust.test.ts
git commit -m "feat(image-engine): add saturation and hue adjustments"
```

---

## Task 5: Limited Unsharp Mask sharpening

**Files:**
- Create: `packages/image-engine/src/sharpen.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/sharpen.test.ts`

**Interfaces:**
- Produces: `sharpen(buf: PixelBuffer, sharpeningValue: number): PixelBuffer` — a 3×3 Unsharp Mask with `amount = sharpeningValue * 0.15`, edge (clamp-aware) handling, and per-channel detail clamped to `±0.5` to limit halos.

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/sharpen.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sharpen } from '../src/sharpen';
import { createPixelBuffer } from '../src/pixel';

function solid(w: number, h: number, v: number) {
  const buf = createPixelBuffer(w, h);
  buf.data.fill(v);
  return buf;
}

describe('sharpen', () => {
  it('sharpening 0 returns identical pixels', () => {
    const buf = solid(3, 3, 0.5);
    const out = sharpen(buf, 0);
    expect(Array.from(out.data)).toEqual(Array.from(buf.data));
  });

  it('a flat image stays flat after sharpening (no detail to enhance)', () => {
    const buf = solid(4, 4, 0.6);
    const out = sharpen(buf, 5);
    for (const v of out.data) expect(v).toBeCloseTo(0.6, 6);
  });

  it('enhances an edge: the bright side gets brighter, dark side darker', () => {
    // 3x1 image: dark | bright | bright
    const buf = createPixelBuffer(3, 1);
    buf.data.set([0.2, 0.2, 0.2, 1, 0.8, 0.8, 0.8, 1, 0.8, 0.8, 0.8, 1]);
    const out = sharpen(buf, 5);
    // The first (dark) pixel sits next to a bright neighbor -> its detail is negative -> darker or equal.
    expect(out.data[0]).toBeLessThanOrEqual(buf.data[0] + 1e-6);
    // The middle (bright) pixel next to a dark neighbor -> enhanced brighter or equal.
    expect(out.data[4]).toBeGreaterThanOrEqual(buf.data[4] - 1e-6);
  });

  it('limits halos: detail is clamped to +-0.5 before scaling (bright center on dark field)', () => {
    // 3x3 image, center pixel = 1, all neighbors = 0.
    // Center detail = 1 - (1/9) = 8/9 > 0.5, so the clamp actually engages.
    const buf = createPixelBuffer(3, 3);
    const c = (1 * 3 + 1) * 4; // center pixel offset
    buf.data[c] = 1;
    buf.data[c + 1] = 1;
    buf.data[c + 2] = 1;
    buf.data[c + 3] = 1;
    const out = sharpen(buf, 10); // amount = 10 * 0.15 = 1.5
    // Unclamped delta would be 1.5 * 8/9 = 1.333; clamped detail (0.5) gives 1.5 * 0.5 = 0.75.
    expect(out.data[c]).toBeCloseTo(1 + 0.75, 5);
    expect(out.data[c]).toBeLessThan(1 + 1.0); // well below the unclamped 2.333
    expect(out.data[c + 3]).toBe(1); // alpha preserved
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test sharpen`
Expected: FAIL — `Cannot find module '../src/sharpen'`.

- [ ] **Step 3: Write sharpen.ts**

```ts
import type { PixelBuffer } from './pixel';
import { createPixelBuffer } from './pixel';

const DETAIL_CLAMP = 0.5; // limits halos (spec §10.2)

/**
 * Limited 3x3 Unsharp Mask. amount = sharpeningValue * 0.15. Per-channel detail
 * (original - box-blur) is clamped to +-DETAIL_CLAMP before being added back.
 * Alpha is left untouched.
 */
export function sharpen(buf: PixelBuffer, sharpeningValue: number): PixelBuffer {
  const amount = sharpeningValue * 0.15;
  if (amount === 0) {
    return { width: buf.width, height: buf.height, data: buf.data.slice() };
  }
  const { width: w, height: h, data } = buf;
  const out = createPixelBuffer(w, h);

  const at = (x: number, y: number, c: number): number => {
    const xx = Math.min(w - 1, Math.max(0, x));
    const yy = Math.min(h - 1, Math.max(0, y));
    return data[(yy * w + xx) * 4 + c];
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const center = data[idx + c];
        const blur =
          (at(x - 1, y - 1, c) + at(x, y - 1, c) + at(x + 1, y - 1, c) +
            at(x - 1, y, c) + center + at(x + 1, y, c) +
            at(x - 1, y + 1, c) + at(x, y + 1, c) + at(x + 1, y + 1, c)) /
          9;
        let detail = center - blur;
        if (detail > DETAIL_CLAMP) detail = DETAIL_CLAMP;
        else if (detail < -DETAIL_CLAMP) detail = -DETAIL_CLAMP;
        out.data[idx + c] = center + amount * detail;
      }
      out.data[idx + 3] = data[idx + 3]; // preserve alpha
    }
  }
  return out;
}
```

In `src/index.ts`, add:
```ts
export * from './sharpen';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test sharpen`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/sharpen.ts packages/image-engine/src/index.ts packages/image-engine/test/sharpen.test.ts
git commit -m "feat(image-engine): add limited unsharp-mask sharpening"
```

---

## Task 6: Intensity blend

**Files:**
- Create: `packages/image-engine/src/blend.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/blend.test.ts`

**Interfaces:**
- Produces: `blendByIntensity(original: PixelBuffer, filtered: PixelBuffer, intensity: number): PixelBuffer` — `out = lerp(original, filtered, clamp01(intensity))`; 1 = fully filtered (default), 0 = original.

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/blend.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { blendByIntensity } from '../src/blend';
import { createPixelBuffer } from '../src/pixel';

function px(v: number) {
  const b = createPixelBuffer(1, 1);
  b.data.set([v, v, v, 1]);
  return b;
}

describe('blendByIntensity', () => {
  it('intensity 1 returns the filtered image', () => {
    const out = blendByIntensity(px(0.2), px(0.8), 1);
    expect(out.data[0]).toBeCloseTo(0.8, 6);
  });

  it('intensity 0 returns the original image', () => {
    const out = blendByIntensity(px(0.2), px(0.8), 0);
    expect(out.data[0]).toBeCloseTo(0.2, 6);
  });

  it('intensity 0.5 is the midpoint', () => {
    const out = blendByIntensity(px(0.2), px(0.8), 0.5);
    expect(out.data[0]).toBeCloseTo(0.5, 6);
  });

  it('clamps intensity to [0,1]', () => {
    expect(blendByIntensity(px(0.2), px(0.8), 2).data[0]).toBeCloseTo(0.8, 6);
    expect(blendByIntensity(px(0.2), px(0.8), -1).data[0]).toBeCloseTo(0.2, 6);
  });

  it('throws on dimension mismatch', () => {
    expect(() => blendByIntensity(px(0.2), createPixelBuffer(2, 2), 0.5)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test blend`
Expected: FAIL — `Cannot find module '../src/blend'`.

- [ ] **Step 3: Write blend.ts**

```ts
import type { PixelBuffer } from './pixel';
import { createPixelBuffer } from './pixel';
import { clamp01 } from './color';

/** Blend original <-> filtered by intensity (clamped to [0,1]; 1 = fully filtered, the default). */
export function blendByIntensity(original: PixelBuffer, filtered: PixelBuffer, intensity: number): PixelBuffer {
  if (original.width !== filtered.width || original.height !== filtered.height) {
    throw new Error('blendByIntensity: dimension mismatch');
  }
  const t = clamp01(intensity);
  const out = createPixelBuffer(original.width, original.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = original.data[i] * (1 - t) + filtered.data[i] * t;
  }
  return out;
}
```

In `src/index.ts`, add:
```ts
export * from './blend';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test blend`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/blend.ts packages/image-engine/src/index.ts packages/image-engine/test/blend.test.ts
git commit -m "feat(image-engine): add intensity blend (original <-> filtered)"
```

---

## Task 7: FilterParams model + fromParsedPictureControl

**Files:**
- Create: `packages/image-engine/src/params.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/params.test.ts`

**Interfaces:**
- Consumes: `ParsedPictureControl` from `@easypic/ncp-parser`; `CurveLut`.
- Produces: `FilterParams` (the shared, renderer-agnostic model) and `fromParsedPictureControl(parsed): FilterParams`.

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/params.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { fromParsedPictureControl } from '../src/params';

const here = dirname(fileURLToPath(import.meta.url));
function parsed(name: string) {
  return parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures', name))));
}

describe('fromParsedPictureControl', () => {
  it('PICCON02 -> color mode, curve enabled, zero sat/hue, no mono', () => {
    const params = fromParsedPictureControl(parsed('PICCON02.NCP'));
    expect(params.baseMode).toBe('color');
    expect(params.curve.size).toBe(257);
    expect(params.curveEnabled).toBe(true);
    expect(params.saturation).toBe(0);
    expect(params.hue).toBe(0);
    expect(params.sharpening).toBe(2);
    expect(params.monoFilter).toBeNull();
    expect(params.toning).toBeNull();
  });

  it('PICCON33 -> monochrome mode with filter 0x83 and toning 0x84 (strength 2)', () => {
    const params = fromParsedPictureControl(parsed('PICCON33.NCP'));
    expect(params.baseMode).toBe('monochrome');
    expect(params.monoFilter?.code).toBe(0x83);
    expect(params.toning?.code).toBe(0x84);
    expect(params.toning?.strength).toBe(2);
    expect(params.sharpening).toBe(2);
  });

  it('disabled curve falls back to an identity LUT', () => {
    const p = parsed('PICCON02.NCP');
    const disabled = { ...p, customCurve: { ...p.customCurve, enabled: false } };
    const params = fromParsedPictureControl(disabled);
    expect(params.curveEnabled).toBe(false);
    expect(params.curve.apply(0.5)).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test params`
Expected: FAIL — `Cannot find module '../src/params'`.

- [ ] **Step 3: Write params.ts**

```ts
import type { ParsedPictureControl } from '@easypic/ncp-parser';
import { CurveLut } from './curve';
import { filterWeightsFor, toningColorFor } from './mono';

export type BaseMode = 'color' | 'monochrome';

export interface MonoFilterParams {
  code: number;
  weights: readonly [number, number, number];
}

export interface ToningParams {
  code: number;
  strength: number;
  color: readonly [number, number, number];
}

/** Renderer-agnostic filter parameter model shared by the Canvas and WebGL paths (spec §5.4). */
export interface FilterParams {
  schemaVersion: number;
  baseMode: BaseMode;
  curveEnabled: boolean;
  curve: CurveLut;
  saturation: number; // NCP 0x80-centered value
  hue: number; // NCP 0x80-centered value
  sharpening: number; // NCP value
  monoFilter: MonoFilterParams | null;
  toning: ToningParams | null;
}

export function fromParsedPictureControl(parsed: ParsedPictureControl): FilterParams {
  const baseMode: BaseMode = parsed.basePictureControl.name === 'Monochrome' ? 'monochrome' : 'color';
  const curveEnabled = parsed.customCurve.enabled;
  const curve = curveEnabled ? CurveLut.from(parsed.customCurve.lut257) : CurveLut.identity();

  let monoFilter: MonoFilterParams | null = null;
  let toning: ToningParams | null = null;
  if (baseMode === 'monochrome') {
    if (parsed.monochromeFilter) {
      monoFilter = { code: parsed.monochromeFilter.code, weights: filterWeightsFor(parsed.monochromeFilter.code) };
    }
    if (parsed.toningType) {
      const color = toningColorFor(parsed.toningType.code);
      if (color) {
        toning = { code: parsed.toningType.code, strength: parsed.toningStrength ?? 0, color };
      }
    }
  }

  return {
    schemaVersion: parsed.schemaVersion,
    baseMode,
    curveEnabled,
    curve,
    saturation: parsed.saturation,
    hue: parsed.hue,
    sharpening: parsed.sharpening,
    monoFilter,
    toning,
  };
}
```

In `src/index.ts`, add:
```ts
export * from './params';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test params`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/params.ts packages/image-engine/src/index.ts packages/image-engine/test/params.test.ts
git commit -m "feat(image-engine): add FilterParams model and parser mapping"
```

---

## Task 8: Pixel pipeline (compose the §10.2 chain)

**Files:**
- Create: `packages/image-engine/src/pipeline.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/pipeline.test.ts`

**Interfaces:**
- Consumes: `PixelBuffer`, `FilterParams`, curve/adjust/mono/sharpen/blend, `clamp01`.
- Produces: `process(input: PixelBuffer, params: FilterParams, intensity?: number): PixelBuffer` applying, in order: curve → saturation & hue → monochrome filter & toning (if monochrome) → sharpen → clamp → blend with original by intensity (default 1).

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/pipeline.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '@easypic/ncp-parser';
import { process } from '../src/pipeline';
import { fromParsedPictureControl, type FilterParams } from '../src/params';
import { CurveLut } from '../src/curve';
import { createPixelBuffer } from '../src/pixel';

const here = dirname(fileURLToPath(import.meta.url));
const astia = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')))),
);
const mono = fromParsedPictureControl(
  parseNcp(new Uint8Array(readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON33.NCP')))),
);

function onePixel(r: number, g: number, b: number) {
  const buf = createPixelBuffer(1, 1);
  buf.data.set([r, g, b, 1]);
  return buf;
}

describe('pipeline.process', () => {
  it('output stays within [0,1]', () => {
    const out = process(onePixel(0.9, 0.5, 0.1), astia, 1);
    for (let i = 0; i < 3; i++) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0);
      expect(out.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('intensity 0 returns the original (no filter applied)', () => {
    const input = onePixel(0.7, 0.4, 0.2);
    const out = process(input, astia, 0);
    expect(out.data[0]).toBeCloseTo(0.7, 6);
    expect(out.data[1]).toBeCloseTo(0.4, 6);
    expect(out.data[2]).toBeCloseTo(0.2, 6);
  });

  it('preserves alpha', () => {
    const input = onePixel(0.5, 0.5, 0.5);
    input.data[3] = 0.25;
    const out = process(input, astia, 1);
    expect(out.data[3]).toBeCloseTo(0.25, 6);
  });

  it('monochrome mode collapses color to grayscale (R==G==B before any toning tint split)', () => {
    const out = process(onePixel(0.8, 0.4, 0.2), mono, 1);
    // Monochrome with toning: channels differ only by the toning tint; with the
    // PICCON33 toning (0x84) the result is a tinted gray, but luminance-like and bounded.
    for (let i = 0; i < 3; i++) {
      expect(out.data[i]).toBeGreaterThanOrEqual(0);
      expect(out.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('monochrome without toning collapses to R==G==B == Rec.709 luminance (pins the mono stage)', () => {
    const monoNoToning: FilterParams = {
      schemaVersion: 1,
      baseMode: 'monochrome',
      curveEnabled: false,
      curve: CurveLut.identity(),
      saturation: 0,
      hue: 0,
      sharpening: 0, // disable sharpen so the grayscale stays exact
      monoFilter: { code: 0x80, weights: [0.2126, 0.7152, 0.0722] },
      toning: null,
    };
    const out = process(onePixel(0.8, 0.4, 0.2), monoNoToning, 1);
    const luma = 0.2126 * 0.8 + 0.7152 * 0.4 + 0.0722 * 0.2;
    expect(out.data[0]).toBeCloseTo(out.data[1], 5);
    expect(out.data[1]).toBeCloseTo(out.data[2], 5);
    expect(out.data[0]).toBeCloseTo(luma, 5);
  });

  it('does not mutate the input buffer', () => {
    const input = onePixel(0.7, 0.4, 0.2);
    const snapshot = Array.from(input.data);
    process(input, astia, 1);
    expect(Array.from(input.data)).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test pipeline`
Expected: FAIL — `Cannot find module '../src/pipeline'`.

- [ ] **Step 3: Write pipeline.ts**

```ts
import type { PixelBuffer } from './pixel';
import { clonePixelBuffer } from './pixel';
import type { FilterParams } from './params';
import { clamp01, REC709 } from './color';
import { applySaturation, applyHue } from './adjust';
import { monoToGray, applyToning } from './mono';
import { sharpen } from './sharpen';
import { blendByIntensity } from './blend';

/**
 * Apply the full filter chain (spec §10.2 order):
 *   curve -> saturation & hue -> monochrome filter & toning (if mono) -> sharpen -> clamp
 * then blend with the original by intensity (default 1 = fully filtered).
 * Works in float; clamps to [0,1] only at the end. Does not mutate `input`.
 */
export function process(input: PixelBuffer, params: FilterParams, intensity: number = 1): PixelBuffer {
  const original = input;
  const work = clonePixelBuffer(input);
  const { data } = work;

  // 1) 257-point curve (same master curve on R,G,B).
  for (let i = 0; i < data.length; i += 4) {
    data[i] = params.curve.apply(data[i]);
    data[i + 1] = params.curve.apply(data[i + 1]);
    data[i + 2] = params.curve.apply(data[i + 2]);
  }

  // 2) Saturation & hue.
  for (let i = 0; i < data.length; i += 4) {
    let [r, g, b] = applySaturation(data[i], data[i + 1], data[i + 2], params.saturation);
    [r, g, b] = applyHue(r, g, b, params.hue);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }

  // 3) Monochrome filter & toning (collapse to grayscale, then tint) — color mode is a no-op.
  if (params.baseMode === 'monochrome') {
    const weights = params.monoFilter?.weights ?? REC709;
    for (let i = 0; i < data.length; i += 4) {
      const gray = monoToGray(data[i], data[i + 1], data[i + 2], weights);
      if (params.toning) {
        const [tr, tg, tb] = applyToning(gray, params.toning.color, params.toning.strength);
        data[i] = tr;
        data[i + 1] = tg;
        data[i + 2] = tb;
      } else {
        data[i] = gray;
        data[i + 1] = gray;
        data[i + 2] = gray;
      }
    }
  }

  // 4) Sharpen (limited unsharp mask).
  const sharpened = sharpen(work, params.sharpening);

  // 5) Clamp to [0,1] at the output.
  for (let i = 0; i < sharpened.data.length; i += 4) {
    sharpened.data[i] = clamp01(sharpened.data[i]);
    sharpened.data[i + 1] = clamp01(sharpened.data[i + 1]);
    sharpened.data[i + 2] = clamp01(sharpened.data[i + 2]);
  }

  // 6) Blend with the original by intensity.
  return blendByIntensity(original, sharpened, intensity);
}
```

In `src/index.ts`, add:
```ts
export * from './pipeline';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test pipeline`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/pipeline.ts packages/image-engine/src/index.ts packages/image-engine/test/pipeline.test.ts
git commit -m "feat(image-engine): add pixel pipeline composing the spec filter chain"
```

---

## Task 9: Input sizing, pixel-limit guard, EXIF orientation geometry

**Files:**
- Create: `packages/image-engine/src/sizing.ts`
- Modify: `packages/image-engine/src/index.ts`
- Test: `packages/image-engine/test/sizing.test.ts`

**Interfaces:**
- Produces: `DEFAULT_PREVIEW_LONG_EDGE = 2048`, `LOW_MEMORY_PREVIEW_LONG_EDGE = 1280`, `MAX_SIDE = 10000`, `MAX_TOTAL_PIXELS = 80_000_000`; `computePreviewSize(width, height, maxLongEdge?): { width, height }`; `assertWithinPixelLimits(width, height): void` (throws if a side > MAX_SIDE or total > MAX_TOTAL_PIXELS); `orientationSwapsDimensions(orientation: number): boolean` and `orientationMatrix(orientation: number)` describing the EXIF transform (pure geometry for the render layer).

- [ ] **Step 1: Write the failing test**

`packages/image-engine/test/sizing.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PREVIEW_LONG_EDGE,
  LOW_MEMORY_PREVIEW_LONG_EDGE,
  computePreviewSize,
  assertWithinPixelLimits,
  orientationSwapsDimensions,
} from '../src/sizing';

describe('computePreviewSize', () => {
  it('defaults to a 2048 long edge', () => {
    expect(DEFAULT_PREVIEW_LONG_EDGE).toBe(2048);
    expect(LOW_MEMORY_PREVIEW_LONG_EDGE).toBe(1280);
  });

  it('scales down a large landscape image preserving aspect', () => {
    const s = computePreviewSize(4096, 2048);
    expect(s.width).toBe(2048);
    expect(s.height).toBe(1024);
  });

  it('scales down a large portrait image preserving aspect', () => {
    const s = computePreviewSize(3000, 6000, 2048);
    expect(s.height).toBe(2048);
    expect(s.width).toBe(1024);
  });

  it('does not upscale a small image', () => {
    const s = computePreviewSize(800, 600);
    expect(s.width).toBe(800);
    expect(s.height).toBe(600);
  });

  it('low-memory cap is smaller', () => {
    const s = computePreviewSize(4000, 2000, LOW_MEMORY_PREVIEW_LONG_EDGE);
    expect(s.width).toBe(1280);
  });
});

describe('assertWithinPixelLimits', () => {
  it('accepts a normal image', () => {
    expect(() => assertWithinPixelLimits(6000, 4000)).not.toThrow();
  });

  it('rejects a side over 10000px', () => {
    expect(() => assertWithinPixelLimits(10001, 100)).toThrow(/10000|side|dimension/i);
  });

  it('rejects over 80 megapixels total', () => {
    expect(() => assertWithinPixelLimits(9000, 9000)).toThrow(/pixels|total|large/i);
  });
});

describe('orientation', () => {
  it('orientations 5-8 swap dimensions; 1-4 do not', () => {
    for (const o of [1, 2, 3, 4]) expect(orientationSwapsDimensions(o)).toBe(false);
    for (const o of [5, 6, 7, 8]) expect(orientationSwapsDimensions(o)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test sizing`
Expected: FAIL — `Cannot find module '../src/sizing'`.

- [ ] **Step 3: Write sizing.ts**

```ts
export const DEFAULT_PREVIEW_LONG_EDGE = 2048;
export const LOW_MEMORY_PREVIEW_LONG_EDGE = 1280;
export const MAX_SIDE = 10000;
export const MAX_TOTAL_PIXELS = 80_000_000;

/** Scale (without upscaling) so the longest edge is <= maxLongEdge, preserving aspect ratio. */
export function computePreviewSize(
  width: number,
  height: number,
  maxLongEdge: number = DEFAULT_PREVIEW_LONG_EDGE,
): { width: number; height: number } {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };
  const scale = maxLongEdge / longEdge;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Guard against decompression bombs / browser crashes (spec §10.1). */
export function assertWithinPixelLimits(width: number, height: number): void {
  if (width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error(`Image dimension ${Math.max(width, height)}px exceeds the ${MAX_SIDE}px side limit`);
  }
  if (width * height > MAX_TOTAL_PIXELS) {
    throw new Error(`Image total ${width * height} pixels exceeds the ${MAX_TOTAL_PIXELS} pixel limit`);
  }
}

/** EXIF orientations 5-8 rotate 90/270 degrees and therefore swap width/height. */
export function orientationSwapsDimensions(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Pure description of the EXIF orientation transform for the render layer.
 * Returns { rotate (degrees cw), flipH } applied after any dimension swap is handled by the caller.
 */
export function orientationTransform(orientation: number): { rotate: number; flipH: boolean } {
  switch (orientation) {
    case 2: return { rotate: 0, flipH: true };
    case 3: return { rotate: 180, flipH: false };
    case 4: return { rotate: 180, flipH: true };
    case 5: return { rotate: 90, flipH: true };
    case 6: return { rotate: 90, flipH: false };
    case 7: return { rotate: 270, flipH: true };
    case 8: return { rotate: 270, flipH: false };
    default: return { rotate: 0, flipH: false }; // 1 or unknown
  }
}
```

In `src/index.ts`, add:
```ts
export * from './sizing';
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test sizing`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/image-engine/src/sizing.ts packages/image-engine/src/index.ts packages/image-engine/test/sizing.test.ts
git commit -m "feat(image-engine): add preview sizing, pixel-limit guard, and EXIF orientation geometry"
```

---

## Task 10: Build, exports, and final verification (core)

**Files:**
- Verify: `packages/image-engine/tsup.config.ts`, `package.json` (from Task 0); `src/index.ts` exports.

**Interfaces:**
- Produces: a consumable ESM build (`dist/index.js` + `dist/index.d.ts`) exposing the full core (PixelBuffer, FilterParams/fromParsedPictureControl, CurveLut, transforms, pipeline, sizing).

- [ ] **Step 1: Typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine typecheck`
Expected: no errors.

- [ ] **Step 2: Build**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine build`
Expected: tsup emits `dist/index.js`, `dist/index.d.ts` (+ sourcemap). `@easypic/ncp-parser` is external (not bundled).

- [ ] **Step 3: Smoke-test the built library as a consumer**

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && cd packages/image-engine && node --input-type=module -e "import { process, fromParsedPictureControl, CurveLut, computePreviewSize } from './dist/index.js'; console.log(typeof process, typeof fromParsedPictureControl, typeof CurveLut, typeof computePreviewSize);"
```
Expected: `function function function function`. (Run from inside `packages/image-engine` so the workspace dep resolves.)

- [ ] **Step 4: Run the full suite and confirm dist is ignored**

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/image-engine test
git status --short   # nothing under packages/image-engine/dist
```
Expected: all image-engine tests pass; `git status` shows nothing under `packages/image-engine/dist`.

- [ ] **Step 5: Milestone commit**

```bash
git commit --allow-empty -m "chore(image-engine): v0.1.0 filter-math core complete (pipeline, params, transforms, sizing)"
```

---

## Out of scope for this plan (next image-engine plan)

The Canvas 2D reference renderer, the WebGL renderer (sharing `FilterParams`, validated by a pixel-tolerance test against the Canvas path), file decode (createImageBitmap + EXIF orientation application), export/encode (JPG q0.92 / PNG, preserve dimensions, tiling for large images), the Web Worker that runs `process` off the main thread, and the public engine API consumed by `web-app`. All build on the `FilterParams` + `pipeline.process` delivered here, which is why the parameter model and the reference per-pixel implementation are locked first (spec §5.4).
