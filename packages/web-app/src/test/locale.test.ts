import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  appHomeHref,
  applyLocaleHtml,
  bootFromBrowser,
  bootLocale,
  decideEnter,
  explicitZh,
  languageHref,
  localeBootSource,
  localeUrls,
  matchLanguages,
  pageLang,
  parsePlace,
  prefixFromDeployValue,
  readManualPref,
  pageLangFromRoute,
  routerBasepath,
  type AppLang,
} from '../lib/locale';

// Actual lang.js from rende-site fdaa701. shell-topbar.js is that same build's topbar.
const shellLang = readFileSync(resolve(process.cwd(), 'src/test/fixtures/shell-lang.js'), 'utf8');

interface SharedHost {
  rf: {
    place(pathname: string): { site: { id: string; base: string; en: boolean }; lang: AppLang; rest: string };
    match(tags: readonly unknown[]): AppLang | null;
    pref(): AppLang | null;
    href(lang: AppLang): string;
    enter(): void;
    leaving: boolean;
    sites: ReadonlyArray<{ id: string; en: boolean }>;
  };
  location: { pathname: string; search: string; hash: string; replaced: string[] };
}

function loadShared(init: {
  pathname?: string;
  search?: string;
  hash?: string;
  languages?: string[];
  storage?: { getItem(key: string): string | null; setItem?(key: string, value: string): void };
  cookie?: string;
  offersEn?: boolean;
} = {}): SharedHost {
  const location = {
    pathname: init.pathname ?? '/',
    search: init.search ?? '',
    hash: init.hash ?? '',
    protocol: 'https:',
    replaced: [] as string[],
    replace(url: string) {
      this.replaced.push(url);
    },
  };
  const storage = init.storage ?? { getItem: () => null };
  const document = {
    cookie: init.cookie ?? '',
    currentScript: null,
    querySelector(selector: string) {
      return init.offersEn && selector.includes('hreflang="en"') ? { tagName: 'LINK' } : null;
    },
  };
  const languages = init.languages ?? ['en-US'];
  const context = createContext({
    window: {} as { rfLang?: SharedHost['rf'] },
    document,
    location,
    navigator: { languages, language: languages[0] },
    localStorage: storage,
    console,
  });
  runInContext(shellLang, context);
  const rf = (context.window as { rfLang: SharedHost['rf'] }).rfLang;
  return { rf, location };
}

describe('locale place and routing', () => {
  it('keeps the deploy prefix separate from the language segment', () => {
    expect(prefixFromDeployValue('easypic')).toBe('/easypic');
    expect(prefixFromDeployValue('/easypic/')).toBe('/easypic');
    expect(prefixFromDeployValue('')).toBe('');
    expect(parsePlace('/easypic/en/work', '/easypic/')).toEqual({
      prefix: '/easypic',
      lang: 'en',
      rest: 'work',
    });
    expect(parsePlace('/easypic', '/easypic')).toEqual({ prefix: '/easypic', lang: 'zh', rest: '' });
    expect(parsePlace('/preview/en/', '/preview').lang).toBe('en');
    expect(parsePlace('/other/en/', '/preview').lang).toBe('zh');
    expect(routerBasepath('/easypic/en/', '/easypic/')).toBe('/easypic');
    expect(routerBasepath('/easypic/?lang=zh', '/easypic/')).toBe('/easypic');
    expect(routerBasepath('/en/', '/')).toBe('/');
    expect(pageLangFromRoute('/en/')).toBe('en');
    expect(pageLangFromRoute('/')).toBe('zh');
    expect(pageLang('/easypic/en/', '?lang=zh', '/easypic')).toBe('en');
    expect(pageLang('/easypic/', '?lang=en', '/easypic')).toBe('zh');
  });

  it('builds canonicals from the deploy prefix without putting language into the asset base', () => {
    expect(localeUrls('easypic')).toEqual({
      prefix: '/easypic',
      mount: '/easypic/',
      zh: 'https://rende.fun/easypic/',
      en: 'https://rende.fun/easypic/en/',
    });
    expect(localeUrls(undefined)).toEqual({
      prefix: '',
      mount: '/',
      zh: 'https://rende.fun/',
      en: 'https://rende.fun/en/',
    });
    const html = applyLocaleHtml(
      '<html data-easypic-prefix="__EASYPIC_PREFIX__"><link href="__EASYPIC_CANONICAL_ZH__"><link href="__EASYPIC_CANONICAL_EN__">',
      localeUrls('easypic'),
    );
    expect(html).toContain('data-easypic-prefix="/easypic"');
    expect(html).toContain('https://rende.fun/easypic/en/');
    expect(html).not.toContain('__EASYPIC');
  });
});

describe('locale decision', () => {
  const base = {
    pathname: '/easypic/',
    search: '',
    hash: '',
    prefix: '/easypic',
    languages: ['en-US'] as const,
    pref: null,
    offersEn: true,
  };

  it('follows url, then manual choice, then ordered languages, then English', () => {
    expect(explicitZh('?album=1&lang=zh')).toBe(true);
    expect(explicitZh('?lang=zh-CN')).toBe(false);
    expect(explicitZh('?lang=en')).toBe(false);
    expect(matchLanguages(['fr-FR', 'zh-HK', 'en'])).toBe('zh');
    expect(matchLanguages(['zh-TW'])).toBe('zh');
    expect(matchLanguages(['en-US', 'zh-CN'])).toBe('en');
    expect(matchLanguages(['fr', 'de'])).toBeNull();

    expect(decideEnter({ ...base, pathname: '/easypic/en/', pref: 'zh', languages: ['zh-CN'] })).toMatchObject({
      redirectTo: null,
      lang: 'en',
      source: 'url',
    });
    expect(decideEnter({ ...base, search: '?x=1&lang=zh', hash: '#p', languages: ['en-US'] })).toMatchObject({
      redirectTo: null,
      lang: 'zh',
      source: 'url',
    });
    expect(decideEnter({ ...base, pref: 'zh', languages: ['en-US'] }).redirectTo).toBeNull();
    expect(decideEnter({ ...base, pref: 'en', search: '?a=1', hash: '#z' }).redirectTo).toBe('/easypic/en/?a=1#z');
    expect(decideEnter({ ...base, languages: ['fr-FR', 'zh-HK', 'en'] }).redirectTo).toBeNull();
    expect(decideEnter({ ...base, languages: ['fr', 'de'] })).toMatchObject({
      redirectTo: '/easypic/en/',
      source: 'default',
    });
    expect(decideEnter({ ...base, languages: ['en-US', 'zh-CN'], offersEn: false }).redirectTo).toBeNull();
  });

  it('keeps unrelated query values and drops only the lang marker', () => {
    const place = parsePlace('/easypic/en/work', '/easypic');
    expect(languageHref(place, 'zh', '?a=1&lang=en&b=2', '#h')).toBe('/easypic/work?a=1&b=2&lang=zh#h');
    expect(languageHref(parsePlace('/easypic/work', '/easypic'), 'en', '?a=1&lang=zh', '#h')).toBe(
      '/easypic/en/work?a=1#h',
    );
  });

  it('reads a manual preference when storage or cookies throw', () => {
    expect(readManualPref(() => 'en', () => {
      throw new Error('cookie blocked');
    })).toBe('en');
    expect(readManualPref(() => {
      throw new Error('storage blocked');
    }, () => 'zh')).toBe('zh');
    expect(readManualPref(() => {
      throw new Error('storage blocked');
    }, () => {
      throw new Error('cookie blocked');
    })).toBeNull();
  });

  it('carries an explicit Chinese choice home only when it was not stored', () => {
    expect(appHomeHref('/easypic/en/?a=1', '?a=1', '/easypic', 'zh')).toBe('/easypic/en/');
    expect(appHomeHref('/easypic/', '?lang=zh', '/easypic', null)).toBe('/easypic/?lang=zh');
    expect(appHomeHref('/easypic/', '?lang=zh', '/easypic', 'zh')).toBe('/easypic/');
    expect(appHomeHref('/preview/', '', '/preview', null)).toBe('/preview/');
  });
});

describe('shared lang.js contract', () => {
  it('matches place, match, pref, href, and enter for the /easypic prefix', () => {
    const host = loadShared({
      pathname: '/easypic/',
      search: '?a=1',
      hash: '#z',
      languages: ['en-GB'],
      offersEn: true,
    });
    expect(host.rf.sites.find((site) => site.id === 'easypic')?.en).toBe(true);
    expect(host.rf.place('/easypic').site.id).toBe('easypic');
    expect(host.rf.place('/easypic/en/work')).toMatchObject({ lang: 'en', rest: 'work' });
    expect(host.rf.match(['fr-FR', 'zh-TW', 'en'])).toBe('zh');
    expect(host.rf.href('en')).toBe(languageHref(parsePlace('/easypic/', '/easypic'), 'en', '?a=1', '#z'));
    host.location.pathname = '/easypic/en/work';
    host.location.search = '?a=1&lang=zh';
    host.location.hash = '#z';
    expect(host.rf.href('zh')).toBe('/easypic/work?a=1&lang=zh#z');
    expect(host.rf.pref()).toBeNull();

    host.location.pathname = '/easypic/';
    host.location.search = '?a=1';
    host.rf.enter();
    expect(host.location.replaced).toEqual(['/easypic/en/?a=1#z']);
    expect(host.rf.leaving).toBe(true);

    const stayed = loadShared({ pathname: '/easypic/en/', languages: ['zh-CN'], offersEn: true });
    stayed.rf.enter();
    expect(stayed.location.replaced).toEqual([]);

    const marked = loadShared({ pathname: '/easypic/', search: '?lang=zh', languages: ['en-US'], offersEn: true });
    marked.rf.enter();
    expect(marked.location.replaced).toEqual([]);
  });

  it('does not call the shared enter for a prefix the site table cannot see', () => {
    let entered = 0;
    const replaced: string[] = [];
    let left = false;
    bootLocale({
      pathname: '/preview/',
      search: '?a=1',
      hash: '#z',
      prefix: '/preview',
      languages: ['en-US'],
      pref: null,
      offersEn: true,
      rfLang: { enter: () => { entered += 1; } },
      replace: (url) => replaced.push(url),
      markLeaving: () => { left = true; },
    });
    expect(entered).toBe(0);
    expect(left).toBe(true);
    expect(replaced).toEqual(['/preview/en/?a=1#z']);

    const shared = loadShared({ pathname: '/preview/en/' });
    expect(shared.rf.place('/preview/en/').site.id).toBe('home');
    expect(shared.rf.place('/preview/en/').lang).toBe('zh');
  });

  it('delegates the production prefix to the shared enter', () => {
    let entered = 0;
    const replaced: string[] = [];
    bootLocale({
      pathname: '/easypic/',
      search: '',
      hash: '',
      prefix: '/easypic/',
      languages: ['en-US'],
      pref: null,
      offersEn: true,
      rfLang: { enter: () => { entered += 1; } },
      replace: (url) => replaced.push(url),
      markLeaving: () => undefined,
    });
    expect(entered).toBe(1);
    expect(replaced).toEqual([]);
  });
});

describe('locale boot script', () => {
  it('inlines one classic script that redirects before paint', () => {
    const source = localeBootSource();
    expect(source).not.toMatch(/<\/script|<!--/i);
    expect(source).not.toContain('import ');
    const location = {
      pathname: '/preview/',
      search: '?a=1',
      hash: '#z',
      replace(url: string) {
        this.replaced.push(url);
      },
      replaced: [] as string[],
    };
    const document = {
      cookie: '',
      documentElement: { getAttribute: () => '/preview' },
      querySelector: () => ({ tagName: 'LINK' }),
    };
    const context = createContext({
      window: {},
      document,
      location,
      navigator: { languages: ['de', 'fr'], language: 'de' },
      localStorage: { getItem: () => null },
      console,
    });
    runInContext(source, context);
    expect(location.replaced).toEqual(['/preview/en/?a=1#z']);
    expect((context.window as { __easypicLeaving?: boolean }).__easypicLeaving).toBe(true);
  });

  it('uses the shared enter when the production prefix and rfLang are both present', () => {
    document.documentElement.setAttribute('data-easypic-prefix', '/easypic');
    let entered = 0;
    window.rfLang = { v: 1, leaving: false, enter: () => { entered += 1; } };
    bootFromBrowser();
    expect(entered).toBe(1);
    delete window.rfLang;
    document.documentElement.removeAttribute('data-easypic-prefix');
  });
});
