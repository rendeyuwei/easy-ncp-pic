import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/connection';
import { migrate } from '../src/migrate';
import { CategoryRepository } from '../src/categories';
import { backupDatabase } from '../src/backup';

describe('backupDatabase', () => {
  it('produces a restorable snapshot containing the data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'easypic-backup-'));
    const srcPath = join(dir, 'src.db');
    const destPath = join(dir, 'backup.db');
    try {
      const src = openDatabase(srcPath);
      migrate(src);
      new CategoryRepository(src).create({ name: 'Film', slug: 'film' });

      await backupDatabase(src, destPath);
      src.close();

      expect(existsSync(destPath)).toBe(true);
      const restored = openDatabase(destPath);
      const rows = restored.prepare(`SELECT slug FROM filter_categories`).all() as { slug: string }[];
      expect(rows.map((r) => r.slug)).toEqual(['film']);
      restored.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
