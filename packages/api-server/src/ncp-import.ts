import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { makeSlug } from '@easypic/database';
import { parseNcp, NcpParseError } from '@easypic/ncp-parser';
import type { ParsedPictureControl } from '@easypic/ncp-parser';
import type { AppDb } from './db';
import { MAX_NCP_BYTES } from './routes/admin-filters';
import { SLUG_PATTERN } from './routes/admin-input';

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_NOT_FOUND = 2;

export const DEFAULT_CATEGORY_SLUG = 'imported';
export const DEFAULT_CATEGORY_NAME = '导入';

const NCP_EXT = /\.ncp$/i;
const SLUG_RE = new RegExp(`^${SLUG_PATTERN}$`);
const MAX_DISPLAY_NAME = 100;
const MAX_DESCRIPTION = 500;

export interface NcpImportIo {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface NcpImportDeps {
  appDb: AppDb;
  /** Base directory for relative paths; injectable for tests (defaults to process.cwd()). */
  cwd?: string;
}

export interface ManifestEntry {
  file: string;
  displayName?: string;
  description?: string;
  category?: string;
  sortOrder?: number;
  enabled?: boolean;
  sourceUrl?: string;
  license?: string;
}

type OutcomeStatus = 'imported' | 'duplicate' | 'unsupported' | 'invalid';

interface Outcome {
  path: string;
  status: OutcomeStatus;
  detail: string;
}

interface Plan {
  path: string;
  bytes: Uint8Array;
  sha256: string;
  parsed: ParsedPictureControl;
  displayName: string;
  description: string;
  categorySlug: string;
  sortOrder: number;
  isEnabled: boolean;
  slug: string;
}

interface Options {
  targets: string[];
  manifestPath: string | null;
  categorySlug: string;
  categoryName: string;
  disabled: boolean;
  dryRun: boolean;
}

export function ncpImportUsage(): string {
  return [
    'Usage: import-ncp <dir-or-files...> [--manifest manifest.json] [--category <slug>]',
    '       [--category-name <name>] [--disabled] [--dry-run]',
    '',
    'Import Nikon .NCP/.ncp files (directories are scanned non-recursively) into the',
    'filters table. Unsupported or invalid files are reported and skipped; duplicates',
    '(same SHA-256) are skipped. Everything is written in one transaction unless',
    '--dry-run, which reports what would happen without touching the database.',
    '',
    `  --category <slug>        Target category slug (default '${DEFAULT_CATEGORY_SLUG}'; created if missing).`,
    `  --category-name <name>   Display name for a newly created category (default '${DEFAULT_CATEGORY_NAME}').`,
    '  --disabled               Import filters unpublished (isEnabled=false).',
    '  --dry-run                Parse and plan only; write nothing.',
    '  --manifest <file>        JSON array of {file, displayName?, description?, category?,',
    '                           sortOrder?, enabled?, sourceUrl?, license?} metadata entries.',
    '',
    'Exit codes: 0 ok, 1 usage/validation error, 2 not found / conflict.',
  ].join('\n');
}

type ArgsResult = Options | { error: string };

function parseArgs(argv: string[]): ArgsResult {
  const targets: string[] = [];
  let manifestPath: string | null = null;
  let categorySlug = DEFAULT_CATEGORY_SLUG;
  let categoryName: string | null = null;
  let disabled = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    switch (arg) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--disabled':
        disabled = true;
        break;
      case '--manifest':
        if (!argv[i + 1]) return { error: '--manifest needs a path.' };
        manifestPath = argv[++i] as string;
        break;
      case '--category': {
        if (!argv[i + 1]) return { error: '--category needs a slug.' };
        const slug = argv[++i] as string;
        if (!SLUG_RE.test(slug)) return { error: `Invalid category slug '${slug}' (lowercase alphanumeric with hyphens).` };
        categorySlug = slug;
        break;
      }
      case '--category-name':
        if (!argv[i + 1]) return { error: '--category-name needs a name.' };
        categoryName = argv[++i] as string;
        break;
      default:
        if (arg.startsWith('-')) return { error: `Unknown option: ${arg}` };
        targets.push(arg);
    }
  }

  if (targets.length === 0 && manifestPath === null) return { error: 'No input files or directories given.' };
  return {
    targets,
    manifestPath,
    categorySlug,
    categoryName: categoryName ?? (categorySlug === DEFAULT_CATEGORY_SLUG ? DEFAULT_CATEGORY_NAME : categorySlug),
    disabled,
    dryRun,
  };
}

/** Absolute paths win; relative paths resolve against the CWD first, then the manifest's directory. */
function resolveManifestFile(file: string, manifestAbs: string, cwd: string): string | null {
  if (isAbsolute(file)) return existsSync(file) ? file : null;
  const fromCwd = resolve(cwd, file);
  if (existsSync(fromCwd)) return fromCwd;
  const fromManifestDir = resolve(dirname(manifestAbs), file);
  return existsSync(fromManifestDir) ? fromManifestDir : null;
}

class UsageError extends Error {}
class NotFoundError extends Error {}

function requireString(obj: Record<string, unknown>, field: string, where: string, maxLength?: number): string | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new UsageError(`${where}: '${field}' must be a string.`);
  if (maxLength !== undefined && value.length > maxLength) {
    throw new UsageError(`${where}: '${field}' exceeds ${maxLength} characters.`);
  }
  return value;
}

function readManifest(manifestAbs: string, cwd: string): Map<string, ManifestEntry> {
  if (!existsSync(manifestAbs)) throw new NotFoundError(`Manifest not found: ${manifestAbs}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(manifestAbs, 'utf8'));
  } catch (e) {
    throw new UsageError(`Manifest is not readable JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(data)) throw new UsageError('Manifest must be a JSON array of entries.');
  const entries = new Map<string, ManifestEntry>();
  data.forEach((raw, i) => {
    const where = `Manifest entry ${i}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new UsageError(`${where}: must be an object.`);
    const obj = raw as Record<string, unknown>;
    const file = typeof obj.file === 'string' ? obj.file.trim() : undefined;
    if (!file) throw new UsageError(`${where}: 'file' must be a non-empty string.`);
    const path = resolveManifestFile(file, manifestAbs, cwd);
    if (!path) throw new NotFoundError(`${where}: file not found: ${file}`);
    const displayName = requireString(obj, 'displayName', where, MAX_DISPLAY_NAME);
    if (displayName !== undefined && displayName.trim() === '') throw new UsageError(`${where}: 'displayName' must not be blank.`);
    const category = requireString(obj, 'category', where);
    if (category !== undefined && !SLUG_RE.test(category)) throw new UsageError(`${where}: invalid category slug '${category}'.`);
    const sortOrder = obj.sortOrder;
    if (sortOrder !== undefined && (typeof sortOrder !== 'number' || !Number.isInteger(sortOrder))) {
      throw new UsageError(`${where}: 'sortOrder' must be an integer.`);
    }
    const enabled = obj.enabled;
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new UsageError(`${where}: 'enabled' must be a boolean.`);
    entries.set(path, {
      file: path,
      displayName,
      description: requireString(obj, 'description', where),
      category,
      sortOrder,
      enabled,
      sourceUrl: requireString(obj, 'sourceUrl', where),
      license: requireString(obj, 'license', where),
    });
  });
  return entries;
}

function collectFiles(targets: string[], cwd: string): string[] {
  const found: string[] = [];
  for (const target of targets) {
    const abs = resolve(cwd, target);
    if (!existsSync(abs)) throw new NotFoundError(`Path not found: ${target}`);
    if (statSync(abs).isDirectory()) {
      const children = readdirSync(abs, { withFileTypes: true })
        .filter((e) => e.isFile() && NCP_EXT.test(e.name))
        .map((e) => join(abs, e.name))
        .sort();
      found.push(...children);
    } else if (NCP_EXT.test(abs)) {
      found.push(abs);
    } else {
      throw new UsageError(`Only .NCP/.ncp files can be imported: ${target}`);
    }
  }
  return [...new Set(found)];
}

function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
  let candidate = base;
  let n = 1;
  while (taken(candidate)) {
    n += 1;
    candidate = `${base}-${n}`;
  }
  return candidate;
}

function sourceLine(entry: ManifestEntry | undefined): string {
  const parts: string[] = [];
  if (entry?.sourceUrl) parts.push(`Source: ${entry.sourceUrl}`);
  if (entry?.license) parts.push(`License: ${entry.license}`);
  return parts.join(' · ');
}

function executeNcpImport(opts: Options, io: NcpImportIo, deps: NcpImportDeps, cwd: string): number {
  const repos = deps.appDb.repos;
  const manifest = opts.manifestPath ? readManifest(resolve(cwd, opts.manifestPath), cwd) : new Map<string, ManifestEntry>();

  const files = collectFiles(opts.targets, cwd);
  for (const p of manifest.keys()) if (!files.includes(p)) files.push(p);
  files.sort();

  const outcomes: Outcome[] = [];
  const plans: Plan[] = [];
  const seenSha = new Map<string, string>();
  const usedSlugs = new Set<string>();
  const categoryNames = new Map<string, string>([[opts.categorySlug, opts.categoryName]]);

  for (const path of files) {
    const meta = manifest.get(path);
    const size = statSync(path).size;
    if (size === 0) {
      outcomes.push({ path, status: 'invalid', detail: 'empty file' });
      continue;
    }
    if (size > MAX_NCP_BYTES) {
      outcomes.push({ path, status: 'invalid', detail: `larger than ${MAX_NCP_BYTES} bytes` });
      continue;
    }
    const bytes = new Uint8Array(readFileSync(path));
    let parsed: ParsedPictureControl;
    try {
      parsed = parseNcp(bytes);
    } catch (e) {
      if (e instanceof NcpParseError) {
        outcomes.push({ path, status: 'invalid', detail: e.code });
        continue;
      }
      throw e;
    }
    if (!parsed.supported) {
      outcomes.push({ path, status: 'unsupported', detail: parsed.warnings[0] ?? 'unknown enum value' });
      continue;
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const published = repos.filters.findBySha256(sha256);
    if (published) {
      outcomes.push({ path, status: 'duplicate', detail: `already published as '${published.displayName}'` });
      continue;
    }
    const earlier = seenSha.get(sha256);
    if (earlier) {
      outcomes.push({ path, status: 'duplicate', detail: `same content as ${basename(earlier)}` });
      continue;
    }
    seenSha.set(sha256, path);

    const displayName = (meta?.displayName?.trim() || parsed.sourceName.trim() || basename(path, extname(path))).slice(0, MAX_DISPLAY_NAME);
    const categorySlug = meta?.category ?? opts.categorySlug;
    if (!categoryNames.has(categorySlug)) {
      categoryNames.set(categorySlug, categorySlug === opts.categorySlug ? opts.categoryName : categorySlug);
    }

    let description = meta?.description?.trim() ?? '';
    const source = sourceLine(meta);
    if (source) description = description ? `${description}\n${source}` : source;
    if (description.length > MAX_DESCRIPTION) {
      throw new UsageError(`Description for '${basename(path)}' exceeds ${MAX_DESCRIPTION} characters after appending source/license.`);
    }

    const slug = uniqueSlug(makeSlug(displayName), (s) => usedSlugs.has(s) || repos.filters.findBySlug(s) !== null);
    usedSlugs.add(slug);

    plans.push({
      path,
      bytes,
      sha256,
      parsed,
      displayName,
      description,
      categorySlug,
      sortOrder: meta?.sortOrder ?? 0,
      isEnabled: meta?.enabled ?? !opts.disabled,
      slug,
    });
    outcomes.push({
      path,
      status: 'imported',
      detail: `slug=${slug} category=${categorySlug}${repos.categories.findBySlug(categorySlug) ? '' : ' (new category)'}`,
    });
  }

  if (!opts.dryRun && plans.length > 0) {
    try {
      deps.appDb.db.transaction(() => {
        const ids = new Map<string, string>();
        const plannedCategorySlugs = new Set(plans.map((p) => p.categorySlug));
        for (const [slug, name] of categoryNames) {
          if (!plannedCategorySlugs.has(slug)) continue;
          ids.set(slug, (repos.categories.findBySlug(slug) ?? repos.categories.create({ name, slug })).id);
        }
        for (const p of plans) {
          repos.filters.create({
            displayName: p.displayName,
            sourceName: p.parsed.sourceName,
            description: p.description,
            categoryId: ids.get(p.categorySlug) as string,
            slug: p.slug,
            sortOrder: p.sortOrder,
            isEnabled: p.isEnabled,
            ncpBlob: p.bytes,
            ncpSha256: p.sha256,
            parserVersion: p.parsed.schemaVersion,
            parsedJson: JSON.stringify(p.parsed),
          });
        }
      })();
    } catch (e) {
      io.stderr(`Import failed; nothing was committed: ${e instanceof Error ? e.message : String(e)}`);
      return EXIT_NOT_FOUND;
    }
  }

  const counts: Record<OutcomeStatus, number> = { imported: 0, duplicate: 0, unsupported: 0, invalid: 0 };
  io.stdout('file'.padEnd(40) + 'status'.padEnd(13) + 'detail');
  for (const o of outcomes) {
    counts[o.status] += 1;
    io.stdout(basename(o.path).padEnd(40) + o.status.padEnd(13) + o.detail);
  }
  io.stdout(
    `Total ${outcomes.length}: imported ${counts.imported}, duplicate ${counts.duplicate}, ` +
      `unsupported ${counts.unsupported}, invalid ${counts.invalid}.`,
  );
  if (opts.dryRun) io.stdout('Dry run: nothing was written.');
  return EXIT_OK;
}

export async function runNcpImportCli(argv: string[], io: NcpImportIo, deps: NcpImportDeps): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  if (argv.length === 0) {
    io.stderr(ncpImportUsage());
    return EXIT_USAGE;
  }
  if (argv[0] === '--help' || argv[0] === '-h') {
    io.stdout(ncpImportUsage());
    return EXIT_OK;
  }
  const opts = parseArgs(argv);
  if ('error' in opts) {
    io.stderr(opts.error);
    io.stderr(ncpImportUsage());
    return EXIT_USAGE;
  }
  try {
    return executeNcpImport(opts, io, deps, cwd);
  } catch (e) {
    if (e instanceof UsageError) {
      io.stderr(e.message);
      return EXIT_USAGE;
    }
    if (e instanceof NotFoundError) {
      io.stderr(e.message);
      return EXIT_NOT_FOUND;
    }
    throw e;
  }
}
