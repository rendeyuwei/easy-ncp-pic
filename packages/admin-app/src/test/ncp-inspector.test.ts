import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_NCP_FILE_BYTES,
  NcpInspectionError,
  bytesToBase64,
  inspectNcpFile,
  parseStoredPictureControl,
} from '../lib/ncp-inspector';
import { NcpPreview } from '../features/filters/ncp-preview';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureBytes = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON02.NCP')),
);

function fixtureFile(bytes = fixtureBytes, name = 'PICCON02.NCP'): File {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.slice().buffer,
  });
  return file;
}

function storedPictureControl(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: 1,
    sourceFormat: 'ncp',
    sourceVersion: 1,
    sourceName: 'Fuji Astia',
    basePictureControl: { code: 3, name: 'Neutral' },
    sharpening: 2,
    saturation: 0,
    hue: 0,
    monochromeFilter: null,
    toningType: null,
    toningStrength: null,
    customCurve: {
      enabled: true,
      gamma: 1,
      controlPoints: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      lut257: Array.from({ length: 257 }, (_, index) => index / 256),
    },
    supported: true,
    warnings: [],
    ...overrides,
  });
}

async function expectInspectionError(file: File, code: NcpInspectionError['code']): Promise<void> {
  await expect(inspectNcpFile(file)).rejects.toMatchObject({ code });
}

describe('inspectNcpFile', () => {
  it('preserves verified fixture bytes and exposes its parsed summary', async () => {
    const inspection = await inspectNcpFile(fixtureFile());

    expect(inspection.fileName).toBe('PICCON02.NCP');
    expect(inspection.bytes).toHaveLength(638);
    expect(inspection.parsed.sourceName).toBe('Fuji Astia');
    expect(inspection.parsed.supported).toBe(true);
    expect(inspection.summary).toMatchObject({
      sourceVersion: 1,
      schemaVersion: 1,
      baseMode: 'Neutral',
      lutSize: 257,
    });
    expect(Uint8Array.from(atob(bytesToBase64(inspection.bytes)), (character) => character.charCodeAt(0)))
      .toEqual(inspection.bytes);
    expect(fixtureBytes[0]).toBe(0x4e);
  });

  it('rejects an empty file before parsing it', async () => {
    await expectInspectionError(fixtureFile(new Uint8Array(), 'empty.NCP'), 'EMPTY_FILE');
  });

  it('rejects files larger than the local upload limit before parsing them', async () => {
    await expectInspectionError(
      fixtureFile(new Uint8Array(MAX_NCP_FILE_BYTES + 1), 'large.NCP'),
      'FILE_TOO_LARGE',
    );
  });

  it.each([
    [0, 'EMPTY_FILE'],
    [MAX_NCP_FILE_BYTES + 1, 'FILE_TOO_LARGE'],
  ] as const)('rejects a %i-byte file without reading its bytes', async (size, code) => {
    const arrayBuffer = vi.fn(async () => {
      throw new Error('arrayBuffer must not be called');
    });
    const file = { name: 'guarded.NCP', size, arrayBuffer } as unknown as File;

    await expectInspectionError(file, code);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('maps a wrong binary signature to an invalid-NCP error', async () => {
    const damaged = fixtureBytes.slice();
    damaged[0] = 0;

    await expectInspectionError(fixtureFile(damaged), 'INVALID_NCP');
  });

  it('keeps an unsupported parsed NCP available on the typed error', async () => {
    const unsupported = fixtureBytes.slice();
    unsupported[0x24] = 0xff;

    await expect(inspectNcpFile(fixtureFile(unsupported))).rejects.toMatchObject({
      code: 'UNSUPPORTED_NCP',
      inspection: {
        fileName: 'PICCON02.NCP',
        parsed: { supported: false, basePictureControl: { code: 255, name: 'unknown' } },
      },
    });
  });
});

describe('bytesToBase64', () => {
  it('round-trips arbitrary binary bytes without a whole-array conversion', () => {
    const bytes = new Uint8Array([0, 255, 128, 1, 2, 3, 254]);

    expect(Uint8Array.from(atob(bytesToBase64(bytes)), (character) => character.charCodeAt(0)))
      .toEqual(bytes);
  });
});

describe('parseStoredPictureControl', () => {
  it('returns null for malformed stored JSON instead of throwing', () => {
    expect(parseStoredPictureControl('{not valid')).toBeNull();
  });

  it('returns null when a field rendered by the preview has an invalid shape', () => {
    expect(parseStoredPictureControl(storedPictureControl({
      customCurve: { enabled: true, gamma: 1, controlPoints: [], lut257: ['not-a-number'] },
    }))).toBeNull();
  });

  it('returns a complete parsed NCP model for safe stored details', () => {
    expect(parseStoredPictureControl(storedPictureControl())).toMatchObject({
      sourceName: 'Fuji Astia',
      customCurve: { controlPoints: [{ x: 0, y: 0 }, { x: 255, y: 255 }] },
    });
  });
});

describe('NcpPreview', () => {
  it('renders safe color-mode details, counts, and warnings in a definition list', () => {
    const parsed = parseStoredPictureControl(storedPictureControl({ warnings: ['请检查效果'] }));
    if (!parsed) throw new Error('test fixture should be valid');

    render(createElement(NcpPreview, { parsed }));

    expect(screen.getByLabelText('NCP 详情').querySelector('dl')).toBeInTheDocument();
    expect(screen.getByText('Fuji Astia')).toBeInTheDocument();
    expect(screen.getByText('Neutral')).toBeInTheDocument();
    expect(screen.getByText('控制点').nextElementSibling).toHaveTextContent('2');
    expect(screen.getByText('LUT 条目').nextElementSibling).toHaveTextContent('257');
    expect(screen.getByText('饱和度')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('请检查效果');
  });

  it('renders monochrome-only settings instead of color controls', () => {
    const parsed = parseStoredPictureControl(storedPictureControl({
      basePictureControl: { code: 6, name: 'Monochrome' },
      monochromeFilter: { code: 131, name: 'Red' },
      toningType: { code: 132, name: 'Yellow' },
      toningStrength: 2,
    }));
    if (!parsed) throw new Error('test fixture should be valid');

    render(createElement(NcpPreview, { parsed }));

    expect(screen.getByText('滤镜效果')).toBeInTheDocument();
    expect(screen.getByText('Red')).toBeInTheDocument();
    expect(screen.queryByText('饱和度')).not.toBeInTheDocument();
  });
});
