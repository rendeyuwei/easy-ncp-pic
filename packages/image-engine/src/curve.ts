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

  /** Return a defensive copy suitable for GPU upload or structured-clone serialization. */
  toFloat32Array(): Float32Array {
    return this.values.slice();
  }
}
