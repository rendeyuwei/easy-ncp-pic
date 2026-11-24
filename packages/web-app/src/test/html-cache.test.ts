import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHELL_CSS_SRC, SHELL_LANG_SRC, SHELL_TOPBAR_SRC } from '../lib/shell-topbar-html';

const here = dirname(fileURLToPath(import.meta.url));

function locationBlock(conf: string, header: string): string {
  const blocks = conf.split(/(?=^location )/m);
  return blocks.find((block) => block.startsWith(header)) ?? '';
}

describe('public HTML revalidation', () => {
  const conf = readFileSync(resolve(here, '../../../../deploy/nginx/easypic-locations.conf'), 'utf8');

  it('asks browsers to revalidate EasyPic HTML and leaves hashed assets and the API alone', () => {
    expect(locationBlock(conf, 'location = /easypic/index.html')).toContain('add_header Cache-Control "no-cache"');
    expect(locationBlock(conf, 'location ^~ /easypic/ {')).toContain('add_header Cache-Control "no-cache"');

    const assets = locationBlock(conf, 'location ^~ /easypic/assets/');
    expect(assets).toContain('public, immutable');
    expect(assets).not.toContain('no-cache');

    expect(locationBlock(conf, 'location ^~ /easypic/api/')).not.toContain('Cache-Control');
    expect(locationBlock(conf, 'location ^~ /easypic/admin/assets/')).toContain('public, immutable');
    expect(locationBlock(conf, 'location ^~ /easypic/admin/assets/')).not.toContain('no-cache');
  });
});

describe('pinned shell bytes', () => {
  it('matches the rende-site fdaa701 artifacts and not the old unversioned bar', () => {
    const topbar = readFileSync(resolve(here, 'fixtures/shell-topbar.js'));
    const lang = readFileSync(resolve(here, 'fixtures/shell-lang.js'));
    const css = readFileSync(resolve(here, 'fixtures/shell-topbar.css'));
    const old = readFileSync(resolve(here, 'fixtures/topbar-2026-10-22.js'));
    expect(SHELL_TOPBAR_SRC).toBe(`/shell/topbar.${createHash('sha256').update(topbar).digest('hex')}.js`);
    expect(SHELL_LANG_SRC).toBe(`/shell/lang.${createHash('sha256').update(lang).digest('hex')}.js`);
    expect(SHELL_CSS_SRC).toBe(`/shell/topbar.${createHash('sha256').update(css).digest('hex')}.css`);
    expect(topbar.length).toBe(9981);
    expect(lang.length).toBe(3755);
    expect(css.length).toBe(2807);
    expect(topbar.includes(Buffer.from(SHELL_CSS_SRC.slice('/shell/'.length)))).toBe(true);
    expect(topbar.includes(Buffer.from('V=2')) || topbar.includes(Buffer.from('const V=2'))).toBe(true);
    expect(old.includes(Buffer.from('4a304e017601ad56'))).toBe(false);
  });
});
