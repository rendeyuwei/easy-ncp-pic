import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initDb, type AppDb } from '../src/db';
import { runNcpImportCli, type NcpImportIo } from '../src/ncp-import';
import { buildNcp, invalidNcpBytes, truncatedNcpBytes } from './helpers/build-ncp';

const tempDirs: string[] = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'easypic-ncp-import-'));
  tempDirs.push(dir);
  return dir;
}

function writeNcp(dir: string, fileName: string, bytes: Uint8Array): string {
  const path = join(dir, fileName);
  writeFileSync(path, bytes);
  return path;
}

interface CapturedIo extends NcpImportIo {
  out: string[];
  err: string[];
}

function fakeIo(): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line) => out.push(line), stderr: (line) => err.push(line) };
}

function inMemoryDb(): AppDb {
  return initDb(':memory:');
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('import-ncp: happy path', () => {
  it('imports a directory into the default 导入 category', async () => {
    const dir = tempDir();
    const bytes = buildNcp({ name: 'Fuji Astia' });
    writeNcp(dir, 'piccon02.NCP', bytes);
    const db = inMemoryDb();
    const io = fakeIo();

    expect(await runNcpImportCli([dir], io, { appDb: db, cwd: dir })).toBe(0);

    const category = db.repos.categories.findBySlug('imported');
    expect(category).not.toBeNull();
    expect(category!.name).toBe('导入');

    const filters = db.repos.filters.listAll();
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({
      displayName: 'Fuji Astia',
      sourceName: 'Fuji Astia',
      slug: 'fuji-astia',
      description: '',
      categoryId: category!.id,
      isEnabled: true,
      sortOrder: 0,
      ncpSha256: sha(bytes),
      parserVersion: 1,
    });
    expect(JSON.parse(filters[0].parsedJson).sourceName).toBe('Fuji Astia');
    expect(db.repos.filters.getNcpBlob(filters[0].id)).toEqual(bytes);
    expect(io.out.join('\n')).toContain('imported 1');
    db.db.close();
  });

  it('imports an explicitly named file and accepts both .NCP and .ncp extensions', async () => {
    const dir = tempDir();
    const lower = writeNcp(dir, 'one.ncp', buildNcp({ name: 'One', gammaByte: 0x0e }));
    writeNcp(dir, 'two.NCP', buildNcp({ name: 'Two', gammaByte: 0x0f }));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([lower, join(dir, 'two.NCP')], io, { appDb: db, cwd: dir })).toBe(0);
    expect(db.repos.filters.listAll().map((f) => f.displayName).sort()).toEqual(['One', 'Two']);
    db.db.close();
  });

  it('honors --category/--category-name and reuses an existing category', async () => {
    const dir = tempDir();
    writeNcp(dir, 'p.NCP', buildNcp({ name: 'Portrait Plus' }));
    const db = inMemoryDb();
    db.repos.categories.create({ slug: 'portrait', name: 'existing name' });
    const io = fakeIo();
    expect(await runNcpImportCli([dir, '--category', 'portrait'], io, { appDb: db, cwd: dir })).toBe(0);
    expect(db.repos.categories.listAll()).toHaveLength(1); // reused, not duplicated
    const cat = db.repos.categories.findBySlug('portrait')!;
    expect(cat.name).toBe('existing name'); // untouched
    expect(db.repos.filters.listAll()[0].categoryId).toBe(cat.id);

    const dir2 = tempDir();
    writeNcp(dir2, 'q.NCP', buildNcp({ name: 'Another', gammaByte: 0x11 }));
    const db2 = inMemoryDb();
    const io2 = fakeIo();
    expect(await runNcpImportCli([dir2, '--category', 'slide-film', '--category-name', '正片'], io2, { appDb: db2, cwd: dir2 })).toBe(0);
    expect(db2.repos.categories.findBySlug('slide-film')?.name).toBe('正片');
    db.db.close();
    db2.db.close();
  });

  it('imports disabled filters with --disabled', async () => {
    const dir = tempDir();
    writeNcp(dir, 'd.NCP', buildNcp({ name: 'Draft Look' }));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir, '--disabled'], io, { appDb: db, cwd: dir })).toBe(0);
    expect(db.repos.filters.listAll()[0].isEnabled).toBe(false);
    db.db.close();
  });

  it('suffixes derived slugs on collision', async () => {
    const dir = tempDir();
    writeNcp(dir, 'a.NCP', buildNcp({ name: 'Same Name', gammaByte: 0x0e }));
    writeNcp(dir, 'b.NCP', buildNcp({ name: 'Same Name', gammaByte: 0x0f }));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir], io, { appDb: db, cwd: dir })).toBe(0);
    const slugs = db.repos.filters.listAll().map((f) => f.slug).sort();
    expect(slugs).toEqual(['same-name', 'same-name-2']);
    db.db.close();
  });
});

describe('import-ncp: skips and failures', () => {
  it('reports duplicates (existing row and same batch) without importing them', async () => {
    const dir = tempDir();
    const bytes = buildNcp({ name: 'Dup' });
    writeNcp(dir, 'x.NCP', bytes);
    writeNcp(dir, 'y.NCP', bytes); // identical content in the same run
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir], io, { appDb: db, cwd: dir })).toBe(0);
    expect(db.repos.filters.listAll()).toHaveLength(1);
    expect(io.out.join('\n')).toContain('duplicate 1');
    expect(io.out.join('\n')).toContain('same content as');

    const io2 = fakeIo();
    expect(await runNcpImportCli([join(dir, 'x.NCP')], io2, { appDb: db, cwd: dir })).toBe(0);
    expect(io2.out.join('\n')).toContain("already published as 'Dup'");
    expect(db.repos.filters.listAll()).toHaveLength(1);
    db.db.close();
  });

  it('reports an unsupported base Picture Control as unsupported and writes nothing', async () => {
    const dir = tempDir();
    writeNcp(dir, 'weird.NCP', buildNcp({ name: 'Weird', baseCode: 0x7777 }));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir], io, { appDb: db, cwd: dir })).toBe(0);
    expect(io.out.join('\n')).toContain('unsupported 1');
    expect(io.out.join('\n')).toContain('unknown base Picture Control code 30583');
    expect(db.repos.filters.listAll()).toHaveLength(0);
    expect(db.repos.categories.listAll()).toHaveLength(0);
    db.db.close();
  });

  it('reports an unsupported Monochrome filter code as unsupported', async () => {
    const dir = tempDir();
    writeNcp(dir, 'mono.NCP', buildNcp({ name: 'Mono', baseCode: 0x064d, monoFilter: 0x99 }));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir], io, { appDb: db, cwd: dir })).toBe(0);
    expect(io.out.join('\n')).toContain('unsupported 1');
    expect(db.repos.filters.listAll()).toHaveLength(0);
    db.db.close();
  });

  it('reports invalid bytes and truncated files as invalid', async () => {
    const dir = tempDir();
    writeNcp(dir, 'garbage.NCP', invalidNcpBytes());
    writeNcp(dir, 'cut.NCP', truncatedNcpBytes());
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir], io, { appDb: db, cwd: dir })).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('invalid 2');
    expect(text).toMatch(/garbage\.NCP\s+invalid\s+BAD_SIGNATURE/);
    expect(text).toMatch(/cut\.NCP\s+invalid\s+BAD_LENGTH/);
    expect(db.repos.filters.listAll()).toHaveLength(0);
    db.db.close();
  });

  it('fails with exit code 2 on a missing path and keeps exit 0 semantics for clean runs', async () => {
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([join(tempDir(), 'nope')], io, { appDb: db, cwd: process.cwd() })).toBe(2);
    expect(io.err.join('\n')).toMatch(/Path not found/);
    db.db.close();
  });
});

describe('import-ncp: dry run', () => {
  it('reports the plan but writes nothing', async () => {
    const dir = tempDir();
    writeNcp(dir, 'plan.NCP', buildNcp({ name: 'Planned Look' }));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir, '--dry-run'], io, { appDb: db, cwd: dir })).toBe(0);
    expect(io.out.join('\n')).toContain('imported 1');
    expect(io.out.join('\n')).toContain('Dry run: nothing was written.');
    expect(db.repos.filters.listAll()).toHaveLength(0);
    expect(db.repos.categories.listAll()).toHaveLength(0);
    db.db.close();
  });
});

describe('import-ncp: manifest', () => {
  it('applies displayName/description/category/sortOrder/enabled and appends source/license', async () => {
    const dir = tempDir();
    writeNcp(dir, 'e100.NCP', buildNcp({ name: 'Kodak E100' }));
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          file: 'e100.NCP',
          displayName: 'Kodak E100 64',
          description: 'Slide film look',
          category: 'slide',
          sortOrder: 5,
          enabled: false,
          sourceUrl: 'https://example.org/e100',
          license: 'CC0-1.0',
        },
      ]),
    );
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir, '--manifest', 'manifest.json'], io, { appDb: db, cwd: dir })).toBe(0);

    const category = db.repos.categories.findBySlug('slide');
    expect(category).not.toBeNull();
    const filter = db.repos.filters.listAll()[0];
    expect(filter).toMatchObject({
      displayName: 'Kodak E100 64',
      sourceName: 'Kodak E100', // still parsed from the NCP itself
      slug: 'kodak-e100-64',
      description: 'Slide film look\nSource: https://example.org/e100 · License: CC0-1.0',
      categoryId: category!.id,
      sortOrder: 5,
      isEnabled: false,
    });
    expect(db.repos.categories.findBySlug('imported')).toBeNull();
    db.db.close();
  });

  it('resolves manifest entries relative to the manifest directory when the CWD misses', async () => {
    const dir = tempDir();
    const other = tempDir(); // a CWD that does not contain 'rel.NCP'
    writeNcp(dir, 'rel.NCP', buildNcp({ name: 'Relative Look' }));
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify([{ file: 'rel.NCP' }]));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli(['--manifest', join(dir, 'manifest.json')], io, { appDb: db, cwd: other })).toBe(0);
    expect(db.repos.filters.listAll().map((f) => f.displayName)).toEqual(['Relative Look']);
    db.db.close();
  });

  it('rejects malformed manifests with exit code 1', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ not: 'an array' }));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([dir, '--manifest', 'bad.json'], io, { appDb: db, cwd: dir })).toBe(1);
    expect(io.err.join('\n')).toMatch(/JSON array/);
    db.db.close();
  });

  it('fails with exit code 2 when a manifest references a missing file', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify([{ file: 'gone.NCP' }]));
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli(['--manifest', join(dir, 'manifest.json')], io, { appDb: db, cwd: dir })).toBe(2);
    expect(io.err.join('\n')).toMatch(/file not found/);
    db.db.close();
  });
});

describe('import-ncp: usage', () => {
  it('rejects unknown options and non-ncp explicit files with exit code 1', async () => {
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli([tempDir(), '--wat'], io, { appDb: db, cwd: process.cwd() })).toBe(1);
    const io2 = fakeIo();
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.txt'), 'hi');
    expect(await runNcpImportCli([join(dir, 'notes.txt')], io2, { appDb: db, cwd: dir })).toBe(1);
    expect(await runNcpImportCli([], io2, { appDb: db, cwd: dir })).toBe(1);
    db.db.close();
  });

  it('prints help with exit code 0', async () => {
    const db = inMemoryDb();
    const io = fakeIo();
    expect(await runNcpImportCli(['--help'], io, { appDb: db, cwd: process.cwd() })).toBe(0);
    expect(io.out.join('\n')).toMatch(/Usage: import-ncp/);
    db.db.close();
  });
});
