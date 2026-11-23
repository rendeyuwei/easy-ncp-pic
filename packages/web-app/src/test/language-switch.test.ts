import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installLanguageSwitch,
  plainActivation,
  sameAppLanguageHref,
  syncSharedShell,
} from '../lib/language-switch';

describe('same-app language links', () => {
  afterEach(() => {
    window.history.pushState(null, '', '/');
    document.body.innerHTML = '';
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    delete window.__rfBar;
  });

  it('recognizes only the sibling language URL and keeps the query and hash', () => {
    const current = 'http://127.0.0.1:4175/easypic/?album=1#panel';
    expect(sameAppLanguageHref(current, '/easypic/en/?album=1#panel', '/easypic/')).toBe('/easypic/en/?album=1#panel');
    expect(sameAppLanguageHref(
      'http://127.0.0.1:4175/easypic/en/?album=1#panel',
      '/easypic/?album=1&lang=zh#panel',
      '/easypic/',
    )).toBe('/easypic/?album=1&lang=zh#panel');
    expect(sameAppLanguageHref(current, '/shutter/?lang=zh', '/easypic/')).toBeNull();
    expect(sameAppLanguageHref(current, '/easypic/?album=1#panel', '/easypic/')).toBeNull();
    expect(sameAppLanguageHref(current, 'https://example.test/easypic/en/', '/easypic/')).toBeNull();
  });

  it('leaves modified clicks and blank targets to the browser', () => {
    expect(plainActivation({
      button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    })).toBe(true);
    expect(plainActivation({
      button: 0, metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, defaultPrevented: false,
    })).toBe(false);
  });

  it('persists the destination language and does not follow the link', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const choose = vi.fn(() => true);
    window.rfLang = { v: 1, leaving: false, enter() { return undefined; }, choose };
    document.body.innerHTML = '<a class="rf-lang" href="/en/#stay">EN</a><a id="tool" href="#shutter">Tool</a>';
    const stop = installLanguageSwitch(navigate, '/');
    const link = document.querySelector('.rf-lang');
    const seen = vi.fn();
    link?.addEventListener('click', seen);
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();

    expect(seen).not.toHaveBeenCalled();
    expect(choose).toHaveBeenCalledWith('en');
    expect(navigate).toHaveBeenCalledWith('/en/#stay');
    document.getElementById('tool')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(navigate).toHaveBeenCalledTimes(1);
    stop();
    delete window.rfLang;
  });

  it('does not intercept a stale toggle that still points at the current language', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const choose = vi.fn(() => true);
    window.rfLang = { v: 1, leaving: false, enter() { return undefined; }, choose };
    window.history.pushState(null, '', '/');
    document.body.innerHTML = '<a class="rf-lang" href="/en/#stay">EN</a>';
    const stop = installLanguageSwitch(navigate, '/');
    const link = document.querySelector('a');
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    window.history.pushState(null, '', '/en/#stay');
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledTimes(1);
    expect(choose).toHaveBeenCalledWith('en');
    stop();
    delete window.rfLang;
  });

  it('does not write the language preference on back or forward', () => {
    const choose = vi.fn(() => true);
    window.rfLang = { v: 1, leaving: false, enter() { return undefined; }, choose };
    document.documentElement.setAttribute('data-easypic-prefix', '/');
    document.body.innerHTML = '<header class="rf-bar" lang="zh-CN"></header>';
    const current = document.createElement('script');
    current.src = '/shell/topbar.js';
    document.head.append(current);
    const stop = installLanguageSwitch(vi.fn(), '/');
    window.history.pushState(null, '', '/en/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(choose).not.toHaveBeenCalled();
    expect(document.querySelector('.rf-bar')).toBeNull();
    stop();
    delete window.rfLang;
  });

  it('still switches when preference storage throws', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    window.rfLang = {
      v: 1,
      leaving: false,
      enter() { return undefined; },
      choose() {
        throw new DOMException('blocked', 'SecurityError');
      },
    };
    window.history.pushState(null, '', '/');
    document.body.innerHTML = '<a class="rf-lang" href="/en/">EN</a>';
    const stop = installLanguageSwitch(navigate, '/');
    document.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith('/en/');
    stop();
    delete window.rfLang;
  });
});

describe('temporary shared shell replay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    delete window.rfLang;
    delete window.__rfBar;
  });

  it('replays the existing topbar script when the bar language disagrees', () => {
    document.documentElement.setAttribute('data-easypic-prefix', '/');
    window.history.pushState(null, '', '/');
    document.body.innerHTML = '<header class="rf-bar" lang="en"></header>';
    const current = document.createElement('script');
    current.src = '/shell/topbar.js';
    current.dataset.tool = 'easypic';
    document.head.append(current);
    syncSharedShell();
    expect(document.querySelector('.rf-bar')).toBeNull();
    const next = document.querySelector('script[data-tool="easypic"]');
    expect(next?.getAttribute('src')).toContain('/shell/topbar.js');
    expect(next).not.toBe(current);
  });

  it('leaves the bar in place when it already matches the page', () => {
    document.documentElement.setAttribute('data-easypic-prefix', '/');
    window.history.pushState(null, '', '/');
    document.body.innerHTML = '<header class="rf-bar" lang="zh-CN"></header>';
    const current = document.createElement('script');
    current.src = '/shell/topbar.js';
    document.head.append(current);
    syncSharedShell();
    expect(document.querySelector('.rf-bar')).not.toBeNull();
    expect(document.querySelectorAll('script[src*="/shell/topbar.js"]')).toHaveLength(1);
  });
});
