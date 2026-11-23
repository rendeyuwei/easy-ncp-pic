import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { messages } from '../lib/messages';

function html(name: string): string {
  return readFileSync(resolve(process.cwd(), name), 'utf8');
}

describe('language entry html', () => {
  it('publishes both static heads and only boots from the Chinese page', () => {
    const zh = html('index.html');
    const en = html('en/index.html');

    expect(zh).toContain('lang="zh-CN"');
    expect(zh).toContain(messages.zh.description);
    expect(zh).toContain(messages.zh.noscript);
    expect(zh).toContain('hreflang="zh-CN" href="__EASYPIC_CANONICAL_ZH__"');
    expect(zh).toContain('hreflang="en" href="__EASYPIC_CANONICAL_EN__"');
    expect(zh).toContain('hreflang="x-default" href="__EASYPIC_CANONICAL_EN__"');
    expect(zh).toContain('<script src="/shell/lang.js"');
    expect(zh).toContain('<script data-easypic-boot></script>');
    expect(zh).toContain('data-tool="easypic"');
    expect(zh).not.toContain('data-home');

    expect(en).toContain('lang="en"');
    expect(en).toContain(messages.en.description);
    expect(en).toContain(messages.en.noscript);
    expect(en).toContain('rel="canonical" href="__EASYPIC_CANONICAL_EN__"');
    expect(en).not.toContain('data-easypic-boot');
    expect(en).not.toContain(messages.zh.description);
    expect(en).toContain('data-tool="easypic"');
    expect(en).not.toContain('data-home');
  });
});
