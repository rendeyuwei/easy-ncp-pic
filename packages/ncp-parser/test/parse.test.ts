import { describe, it, expect } from 'vitest';
import { parseNcp } from '../src/index';
import { buildNcp } from './helpers/build-ncp';
import { NcpParseError } from '../src/errors';

describe('parseNcp', () => {
  it('parses a well-formed synthetic buffer into the schema', () => {
    const r = parseNcp(buildNcp({ name: 'Demo' }));
    expect(r.schemaVersion).toBe(1);
    expect(r.sourceFormat).toBe('ncp');
    expect(r.sourceVersion).toBe(1);
    expect(r.sourceName).toBe('Demo');
    expect(r.customCurve.lut257).toHaveLength(257);
    expect(Array.isArray(r.warnings)).toBe(true);
  });
  it('flags an all-zero adjustments region as unsupported (unknown base)', () => {
    const r = parseNcp(buildNcp());
    expect(r.supported).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it('throws on truncated input', () => {
    expect(() => parseNcp(buildNcp({ length: 100 }))).toThrowError(NcpParseError);
  });
  it('resolves unknown monochrome filter/toning codes to "unknown" with warnings (no throw)', () => {
    const adj = new Uint8Array(26);
    adj[0] = 0x06;  // base = Monochrome
    adj[4] = 0x82;  // sharpening -> 2
    adj[9] = 0x99;  // monochrome filter -> unknown code
    adj[10] = 0x99; // toning type -> unknown code
    adj[11] = 0x82; // toning strength -> 2
    const r = parseNcp(buildNcp({ adjustments: adj }));
    expect(r.basePictureControl.name).toBe('Monochrome');
    expect(r.monochromeFilter?.name).toBe('unknown');
    expect(r.toningType?.name).toBe('unknown');
    expect(r.supported).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
