import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installLanguageSwitch } from '../lib/language-switch';

const topbar = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/shell-topbar.js'), 'utf8');

function mount(pathname: string): void {
  document.head.replaceChildren();
  document.body.replaceChildren();
  delete window.rfLang;
  delete window.__rfBar;
  const meta = document.createElement('meta');
  meta.name = 'rf-mount';
  meta.content = '/pics/';
  document.head.append(meta);
  for (const [hreflang, href] of [['zh-CN', '/pics/'], ['en', '/pics/en/']] as const) {
    const link = document.createElement('link');
    link.rel = 'alternate';
    link.hreflang = hreflang;
    link.href = href;
    document.head.append(link);
  }
  const marker = document.createElement('script');
  marker.dataset.tool = 'easypic';
  document.body.append(marker);
  window.history.pushState(null, '', pathname);
  window.eval(topbar);
}

function barText(): {
  lang: string | null;
  tools: string;
  back: string;
  nav: string | null;
  names: string[];
  desc: string;
  toggle: string;
  href: string | null;
} {
  return {
    lang: document.querySelector('.rf-bar')?.getAttribute('lang') ?? null,
    tools: document.querySelector('.rf-btn')?.textContent ?? '',
    back: document.querySelector('.rf-home')?.textContent ?? '',
    nav: document.querySelector('.rf-menu')?.getAttribute('aria-label') ?? null,
    names: [...document.querySelectorAll('.rf-n')].map((node) => node.textContent ?? ''),
    desc: document.querySelector('.rf-d')?.textContent ?? '',
    toggle: document.querySelector('.rf-lang')?.textContent ?? '',
    href: document.querySelector('.rf-lang')?.getAttribute('href') ?? null,
  };
}

describe('real v2 shell refresh', () => {
  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
    delete window.rfLang;
    delete window.__rfBar;
    try {
      localStorage.clear();
    } catch {
      // A blocked-storage case replaces the storage getter.
    }
    window.history.pushState(null, '', '/');
  });

  it('refreshes /pics labels on the same bar without new listeners or a preference write on back', () => {
    mount('/pics/?album=1#panel');
    const bar = document.querySelector('.rf-bar');
    const choose = window.rfLang?.choose;
    const added = { click: 0, keydown: 0, hashchange: 0, popstate: 0 };
    const documentAdd = document.addEventListener.bind(document);
    const windowAdd = window.addEventListener.bind(window);
    document.addEventListener = ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      if (type === 'click' || type === 'keydown') added[type] += 1;
      documentAdd(type, listener, options);
    }) as typeof document.addEventListener;
    window.addEventListener = ((type: string, listener: EventListener, options?: boolean | AddEventListenerOptions) => {
      if (type === 'hashchange' || type === 'popstate') added[type] += 1;
      windowAdd(type, listener, options);
    }) as typeof window.addEventListener;

    expect(barText()).toMatchObject({
      lang: 'zh-CN',
      nav: '切换工具',
      desc: '图片压缩与格式转换',
      toggle: 'EN',
      href: '/pics/en/?album=1#panel',
    });
    expect(barText().tools.startsWith('工具')).toBe(true);
    expect(barText().back).toContain('回到主站');
    expect(barText().names).toEqual(['EasyPic', '快门计数', '家常菜本', '全部工具']);

    const toggle = document.querySelector('.rf-lang');
    if (!(toggle instanceof HTMLAnchorElement)) throw new Error('missing toggle');
    toggle.focus();
    localStorage.setItem('rf-lang', 'zh');
    for (let step = 0; step < 5; step += 1) {
      const english = step % 2 === 0;
      window.history.pushState(null, '', english ? '/pics/en/?album=1#panel' : '/pics/?album=1&lang=zh#panel');
      document.dispatchEvent(new Event('rf:locale'));
      expect(document.querySelector('.rf-bar')).toBe(bar);
      expect(document.activeElement?.classList.contains('rf-lang')).toBe(true);
      expect(barText().toggle).toBe(english ? '中文' : 'EN');
      expect(barText().nav).toBe(english ? 'Switch tool' : '切换工具');
    }
    expect(added).toEqual({ click: 0, keydown: 0, hashchange: 0, popstate: 0 });
    expect(window.rfLang?.choose).toBe(choose);
    window.history.pushState(null, '', '/pics/?album=1&lang=zh#panel');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(localStorage.getItem('rf-lang')).toBe('zh');
    expect(barText().toggle).toBe('EN');
    expect(document.querySelector('.rf-bar')).toBe(bar);
  });

  it('still switches labels when storage is blocked and ignores ordinary links', async () => {
    mount('/pics/?album=1#panel');
    const navigate = vi.fn(async (href: string) => {
      window.history.pushState(null, '', href);
    });
    const push = vi.spyOn(window.history, 'pushState');
    const stop = installLanguageSwitch(navigate, '/pics/');
    const storage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    const cookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
      Object.defineProperty(Document.prototype, 'cookie', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
        set() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
      document.querySelector('.rf-menu a')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(navigate).not.toHaveBeenCalled();

      document.querySelector('.rf-lang')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/pics/en/?album=1#panel');
      expect(push).toHaveBeenCalledTimes(1);
      expect(barText()).toMatchObject({
        lang: 'en',
        nav: 'Switch tool',
        desc: 'Image compression and format conversion',
        toggle: '中文',
        href: '/pics/?album=1&lang=zh#panel',
      });
      expect(barText().tools.startsWith('Tools')).toBe(true);
      expect(barText().names).toContain('All tools');
    } finally {
      if (storage) Object.defineProperty(window, 'localStorage', storage);
      if (cookie) Object.defineProperty(Document.prototype, 'cookie', cookie);
      push.mockRestore();
      stop();
    }
  });
});
