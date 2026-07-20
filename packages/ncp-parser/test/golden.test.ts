import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseNcp } from '../src/index';

const here = dirname(fileURLToPath(import.meta.url));

const FIXTURES = {
  'PICCON02.NCP': {
    sha256: 'ed53222f4a2329c3f42a2dd6391b4b62d1214b1e3eac917d9bd11a8f22f9e43f',
    name: 'Fuji Astia',
    base: 'Neutral',
    sharpening: 2,
    saturation: 0,
    hue: 0,
    points: [[0, 0], [52, 53], [169, 178], [250, 245], [252, 248], [255, 255]],
  },
  'PICCON33.NCP': {
    sha256: '5a3e2e9a768234f0fa653f1fc50eef3993118788737e57fe4bbd8d219fa8bc12',
    name: 'SHING TokugawaTone2',
    base: 'Monochrome',
    sharpening: 2,
    filter: 0x83,
    toning: 0x84,
    toningStrength: 2,
    points: [[0, 85], [63, 98], [125, 194], [188, 224], [249, 232]],
  },
} as const;

function load(name: keyof typeof FIXTURES): Uint8Array {
  const p = join(here, 'fixtures', name);
  if (!existsSync(p)) {
    throw new Error(`Missing fixture ${p}. See test/fixtures/README.md.`);
  }
  return new Uint8Array(readFileSync(p));
}

describe('golden: PICCON02.NCP', () => {
  const bytes = load('PICCON02.NCP');
  const f = FIXTURES['PICCON02.NCP'];
  it('matches the verified SHA-256', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
  });
  it('parses name, base, and adjustments', () => {
    const r = parseNcp(bytes);
    expect(r.sourceName).toBe(f.name);
    expect(r.basePictureControl.name).toBe(f.base);
    expect(r.sharpening).toBe(f.sharpening);
    expect(r.saturation).toBe(f.saturation);
    expect(r.hue).toBe(f.hue);
    expect(r.monochromeFilter).toBeNull();
    expect(r.supported).toBe(true);
    expect(r.warnings).toHaveLength(0);
  });
  it('parses the curve control points and 257-point LUT', () => {
    const r = parseNcp(bytes);
    expect(r.customCurve.enabled).toBe(true);
    expect(r.customCurve.controlPoints).toEqual(f.points.map(([x, y]) => ({ x, y })));
    expect(r.customCurve.lut257).toHaveLength(257);
  });
});

describe('golden: PICCON33.NCP', () => {
  const bytes = load('PICCON33.NCP');
  const f = FIXTURES['PICCON33.NCP'];
  it('matches the verified SHA-256', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(f.sha256);
  });
  it('parses monochrome adjustments', () => {
    const r = parseNcp(bytes);
    expect(r.sourceName).toBe(f.name);
    expect(r.basePictureControl.name).toBe(f.base);
    expect(r.sharpening).toBe(f.sharpening);
    expect(r.monochromeFilter?.code).toBe(f.filter);
    expect(r.toningType?.code).toBe(f.toning);
    expect(r.toningStrength).toBe(f.toningStrength);
    expect(r.supported).toBe(true);
  });
  it('parses the curve control points', () => {
    const r = parseNcp(bytes);
    expect(r.customCurve.controlPoints).toEqual(f.points.map(([x, y]) => ({ x, y })));
  });
});
