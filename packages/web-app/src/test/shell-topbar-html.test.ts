import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { preserveShellTopbarHtml, SHELL_LANG_SRC, SHELL_TOPBAR_SRC } from '../lib/shell-topbar-html';

const TOPBAR_TAG = `<script src="${SHELL_TOPBAR_SRC}" defer data-tool="easypic"></script>`;

describe('shared shell top bar', () => {
  it('keeps the root top bar tag and the Baidu stats snippet in index.html', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(preserveShellTopbarHtml(html)).toContain(TOPBAR_TAG);
    expect(html).toContain(`src="${SHELL_TOPBAR_SRC}"`);
    expect(html).toContain(`src="${SHELL_LANG_SRC}"`);
    expect(html).toContain('data-easypic-boot');
    expect(html).toContain('window.rfLang.leaving');
    expect(html).toContain('https://hm.baidu.com/hm.js?f4b1d2fc4d60c37f898b469f83237dab');
  });

  it('rewrites a deployment-prefixed top bar URL back to the site root', () => {
    const html = [
      '<script>',
      'hm.src = "https://hm.baidu.com/hm.js?f4b1d2fc4d60c37f898b469f83237dab";',
      '</script>',
      `<script src="/easypic${SHELL_TOPBAR_SRC}" defer></script>`,
      `<script src="/easypic${SHELL_LANG_SRC}" vite-ignore></script>`,
    ].join('\n');
    const preserved = preserveShellTopbarHtml(html);
    expect(preserved).toContain(TOPBAR_TAG);
    expect(preserved).toContain(`<script src="${SHELL_LANG_SRC}"></script>`);
    expect(preserved).not.toContain(`/easypic${SHELL_TOPBAR_SRC}`);
    expect(preserved).not.toContain(`/easypic${SHELL_LANG_SRC}`);
    expect(preserved).toContain('hm.baidu.com/hm.js?f4b1d2fc4d60c37f898b469f83237dab');
  });
});
