import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preserveShellTopbarHtml } from '../lib/shell-topbar-html';

const TOPBAR_TAG = '<script src="/shell/topbar.js" defer></script>';

describe('shared shell top bar', () => {
  it('keeps the root top bar tag in index.html', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('src="/shell/topbar.js"');
    expect(preserveShellTopbarHtml(html)).toContain(TOPBAR_TAG);
  });

  it('rewrites an admin-prefixed top bar URL back to the site root', () => {
    const preserved = preserveShellTopbarHtml(
      '<script src="/easypic/admin/shell/topbar.js" defer vite-ignore></script>',
    );
    expect(preserved).toBe(TOPBAR_TAG);
  });
});
