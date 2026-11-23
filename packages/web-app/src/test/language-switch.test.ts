import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installLanguageSwitch,
  languageToggleHref,
  plainActivation,
  sameAppLanguageHref,
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

  it('leaves the tools-menu EasyPic link as a normal navigation', async () => {
    const navigate = vi.fn().mockResolvedValue(undefined);
    const choose = vi.fn(() => true);
    window.rfLang = { v: 1, leaving: false, enter() { return undefined; }, choose };
    window.history.pushState(null, '', '/easypic/en/?album=1#panel');
    document.body.innerHTML = '<a href="/easypic/">EasyPic</a>';
    const stop = installLanguageSwitch(navigate, '/easypic/');
    const link = document.querySelector('a');
    link?.addEventListener('click', (event) => event.preventDefault());
    link?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(navigate).not.toHaveBeenCalled();
    expect(choose).not.toHaveBeenCalled();
    stop();
    delete window.rfLang;
  });

  it('does not full-load after an in-memory language change', async () => {
    const navigate = vi.fn(async () => {
      window.history.pushState(null, '', '/en/#stay');
    });
    const assign = vi.fn();
    window.rfLang = { v: 1, leaving: false, enter() { return undefined; }, choose: () => true };
    window.history.pushState(null, '', '/');
    document.body.innerHTML = '<a class="rf-lang" href="/en/#stay">EN</a>';
    const stop = installLanguageSwitch(navigate, '/', assign);
    document.querySelector('a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await navigate.mock.results[0]?.value;
    expect(navigate).toHaveBeenCalledWith('/en/#stay');
    expect(assign).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/en/');
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
    window.__rfBar = 1;
    document.body.innerHTML = '<header class="rf-bar" lang="zh-CN"><a class="rf-lang" href="/en/">EN</a></header>';
    const current = document.createElement('script');
    current.src = '/shell/topbar.js';
    document.head.append(current);
    const stop = installLanguageSwitch(vi.fn(), '/');
    window.history.pushState(null, '', '/en/');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(choose).not.toHaveBeenCalled();
    expect(document.querySelector('.rf-bar')).not.toBeNull();
    expect(window.__rfBar).toBe(1);
    expect(document.querySelectorAll('script[src*="/shell/topbar.js"]')).toHaveLength(1);
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

describe('shared shell stays untouched', () => {
  const documentAdd = document.addEventListener.bind(document);
  const windowAdd = window.addEventListener.bind(window);

  afterEach(() => {
    document.addEventListener = documentAdd;
    window.addEventListener = windowAdd;
    document.body.innerHTML = '';
    document.head.querySelectorAll('script').forEach((script) => script.remove());
    delete window.rfLang;
    delete window.__rfBar;
    window.history.pushState(null, '', '/');
  });

  it('keeps listener counts, the shell script, and __rfBar across repeated toggles', async () => {
    const added = { click: 0, keydown: 0, hashchange: 0 };
    document.addEventListener = ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      if (type === 'click' || type === 'keydown') added[type] += 1;
      documentAdd(type, listener, options);
    }) as typeof document.addEventListener;
    window.addEventListener = ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      if (type === 'hashchange') added.hashchange += 1;
      windowAdd(type, listener, options);
    }) as typeof window.addEventListener;
    const seen: string[] = [];
    const choose = vi.fn(() => true);
    window.rfLang = new Proxy({
      v: 1,
      leaving: false,
      enter() { return undefined; },
      choose,
    }, {
      get(target, prop, receiver) {
        if (typeof prop === 'string') seen.push(prop);
        return Reflect.get(target, prop, receiver);
      },
    });
    window.__rfBar = 1;
    window.history.pushState(null, '', '/?album=1#panel');
    document.body.innerHTML = '<a class="rf-lang" href="/en/?album=1#panel">EN</a>';
    const script = document.createElement('script');
    script.src = '/shell/topbar.js';
    document.head.append(script);
    const navigate = vi.fn().mockResolvedValue(undefined);
    const stop = installLanguageSwitch(navigate, '/');
    const afterInstall = { ...added };
    const link = document.querySelector('a');
    if (!(link instanceof HTMLAnchorElement)) throw new Error('missing toggle');
    link.focus();
    for (let i = 0; i < 5; i += 1) {
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      const next = navigate.mock.calls.at(-1)?.[0] as string;
      window.history.pushState(null, '', next);
      const here = new URL(next, 'http://127.0.0.1');
      const toEnglish = !here.pathname.startsWith('/en');
      const nextPath = toEnglish ? '/en/' : '/';
      const search = new URLSearchParams(here.search);
      if (toEnglish) search.delete('lang');
      else search.set('lang', 'zh');
      const query = search.toString();
      link.href = `${nextPath}${query ? `?${query}` : ''}${here.hash}`;
      link.textContent = toEnglish ? 'EN' : '中文';
      expect(document.activeElement).toBe(link);
    }
    expect(navigate).toHaveBeenCalledTimes(5);
    expect(added).toEqual(afterInstall);
    expect(added.click).toBe(1);
    expect(added.keydown).toBe(0);
    expect(added.hashchange).toBe(0);
    expect(window.__rfBar).toBe(1);
    expect(document.querySelectorAll('script[src*="/shell/topbar.js"]')).toHaveLength(1);
    expect(seen.filter((name) => name !== 'choose')).toEqual([]);
    stop();
  });

  it('stays inside /pics when the shared href would leave the app', async () => {
    const shell = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/shell-lang.js'), 'utf8');
    delete window.rfLang;
    window.eval(shell);
    window.history.pushState(null, '', '/pics/en/?album=1#panel');
    const shared = window.rfLang as unknown as {
      place(pathname: string): { lang: string };
      href(lang: 'zh' | 'en'): string;
    };
    expect(shared.place('/pics/en/').lang).toBe('zh');
    expect(shared.href('en')).toBe('/en/pics/en/?album=1#panel');
    delete window.rfLang;

    const navigate = vi.fn().mockResolvedValue(undefined);
    const assign = vi.fn();
    const choose = vi.fn(() => true);
    window.rfLang = { v: 1, leaving: false, enter() { return undefined; }, choose };
    window.__rfBar = 1;
    document.body.innerHTML = '<a class="rf-lang" href="/en/pics/en/?album=1#panel">EN</a>';
    const link = document.querySelector('a');
    if (!(link instanceof HTMLAnchorElement)) throw new Error('missing toggle');
    link.focus();
    const stop = installLanguageSwitch(navigate, '/pics/', assign);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledWith('/pics/?album=1&lang=zh#panel');
    expect(assign).not.toHaveBeenCalled();
    expect(choose).toHaveBeenCalledWith('zh');
    expect(document.activeElement).toBe(link);
    expect(window.__rfBar).toBe(1);
    expect(languageToggleHref(
      'http://127.0.0.1/pics/en/?album=1#panel',
      '/en/pics/en/?album=1#panel',
      '/pics/',
    )).toBe('/pics/?album=1&lang=zh#panel');
    stop();
  });

  it.todo('calls the published optional shell mount without adding listeners or fetching topbar.js');
});
