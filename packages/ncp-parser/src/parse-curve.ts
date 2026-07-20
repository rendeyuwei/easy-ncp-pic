import { BinaryReader } from './reader';
import { NcpParseError } from './errors';
import { OFF, MAX_POINTS, GAMMA_BASE, GAMMA_STEP } from './constants';
import { readLut257 } from './lut';
import type { CurvePoint, CustomCurve } from './types';

export function readGamma(reader: BinaryReader): number {
  return GAMMA_BASE + reader.uint8(OFF.curveGamma) * GAMMA_STEP;
}

export function readControlPoints(reader: BinaryReader): CurvePoint[] {
  const count = reader.uint8(OFF.pointCount);
  if (count > MAX_POINTS) {
    throw new NcpParseError('BAD_POINT_COUNT', `point count ${count} exceeds max ${MAX_POINTS}`);
  }
  const pts: CurvePoint[] = [];
  for (let i = 0; i < count; i++) {
    pts.push({ x: reader.uint8(OFF.points + i * 2), y: reader.uint8(OFF.points + i * 2 + 1) });
  }
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x <= pts[i - 1].x) {
      throw new NcpParseError(
        'UNORDERED_POINTS',
        `control point ${i} x=${pts[i].x} is not greater than previous x=${pts[i - 1].x}`,
      );
    }
  }
  return pts;
}

export function readCurve(reader: BinaryReader): CustomCurve {
  return {
    enabled: reader.uint8(OFF.curveEnabled) !== 0,
    gamma: readGamma(reader),
    controlPoints: readControlPoints(reader),
    lut257: readLut257(reader),
  };
}
