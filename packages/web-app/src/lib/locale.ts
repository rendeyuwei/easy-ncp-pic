export type AppLang = 'zh' | 'en';
export type LocaleSource = 'url' | 'manual' | 'navigator' | 'default';

export const PUBLIC_ORIGIN = 'https://rende.fun';
export const SHARED_EASYPIC_PREFIX = '/easypic';
export const RF_LANG_KEY = 'rf-lang';

export interface LocalePlace {
  readonly prefix: string;
  readonly lang: AppLang;
  readonly rest: string;
}

export interface EnterDecision {
  readonly redirectTo: string | null;
  readonly lang: AppLang;
  readonly source: LocaleSource;
}

export interface LocaleUrls {
  readonly prefix: string;
  readonly zh: string;
  readonly en: string;
}

export interface BootDeps {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly prefix: string;
  readonly languages: readonly unknown[];
  readonly pref: AppLang | null;
  readonly offersEn: boolean;
  readonly rfLang: { enter(): void } | null;
  replace(url: string): void;
  markLeaving(): void;
}

export function prefixFromDeployValue(value: string | undefined): string {
  const stripped = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return stripped ? `/${stripped}` : '';
}

export function normalizePrefix(baseUrl: string | undefined): string {
  if (!baseUrl || baseUrl === '/') return '';
  const withSlash = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return withSlash.replace(/\/+$/, '');
}

export function parsePlace(pathname: string, prefix: string | undefined): LocalePlace {
  const normalized = normalizePrefix(prefix);
  const path = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  if (normalized && path !== normalized && !path.startsWith(`${normalized}/`)) {
    return { prefix: normalized, lang: 'zh', rest: path.replace(/^\/+/, '') };
  }
  let rest = (normalized ? path.slice(normalized.length) : path).replace(/^\/+/, '');
  let lang: AppLang = 'zh';
  if (rest === 'en' || rest.startsWith('en/')) {
    lang = 'en';
    rest = rest.slice(3).replace(/^\/+/, '');
  }
  return { prefix: normalized, lang, rest };
}

export function explicitZh(search: string): boolean {
  return /(?:^|[?&])lang=zh(?:&|$)/.test(search || '');
}

export function matchLanguages(tags: readonly unknown[]): AppLang | null {
  for (const tag of tags) {
    const primary = String(tag).toLowerCase().split(/[-_]/)[0];
    if (primary === 'zh' || primary === 'en') return primary;
  }
  return null;
}

export function readCookiePref(cookie: string): string | null {
  return /(?:^|;\s*)rf-lang=(zh|en)(?:;|$)/.exec(cookie)?.[1] ?? null;
}

export function readManualPref(
  readStorage: () => string | null,
  readCookie: () => string | null,
): AppLang | null {
  let value: string | null = null;
  try {
    value = readStorage();
  } catch {
    value = null;
  }
  if (value !== 'zh' && value !== 'en') {
    try {
      value = readCookie();
    } catch {
      value = null;
    }
  }
  return value === 'zh' || value === 'en' ? value : null;
}

export function languageQuery(search: string, markZh: boolean): string {
  const parts = (search || '')
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part && part.split('=')[0] !== 'lang');
  if (markZh) parts.push('lang=zh');
  return parts.length ? `?${parts.join('&')}` : '';
}

export function languageHref(place: LocalePlace, lang: AppLang, search: string, hash: string): string {
  const base = place.prefix ? `${place.prefix}/` : '/';
  const path = `${base}${lang === 'en' ? 'en/' : ''}${place.rest}`;
  return `${path}${languageQuery(search, lang === 'zh')}${hash || ''}`;
}

export function decideEnter(input: {
  pathname: string;
  search: string;
  hash: string;
  prefix: string;
  languages: readonly unknown[];
  pref: AppLang | null;
  offersEn: boolean;
}): EnterDecision {
  const place = parsePlace(input.pathname, input.prefix);
  if (place.lang === 'en' || explicitZh(input.search)) {
    return {
      redirectTo: null,
      lang: place.lang === 'en' ? 'en' : 'zh',
      source: 'url',
    };
  }
  const matched = input.pref ?? matchLanguages(input.languages);
  const source: LocaleSource = input.pref ? 'manual' : matched ? 'navigator' : 'default';
  const want = matched ?? 'en';
  if (want === 'en' && input.offersEn) {
    return {
      redirectTo: languageHref(place, 'en', input.search, input.hash),
      lang: 'en',
      source,
    };
  }
  return { redirectTo: null, lang: 'zh', source };
}

export function bootLocale(deps: BootDeps): void {
  const prefix = normalizePrefix(deps.prefix);
  if (deps.rfLang && prefix === '/easypic') {
    deps.rfLang.enter();
    return;
  }
  const decision = decideEnter({
    pathname: deps.pathname,
    search: deps.search,
    hash: deps.hash,
    prefix,
    languages: deps.languages,
    pref: deps.pref,
    offersEn: deps.offersEn,
  });
  if (!decision.redirectTo) return;
  const current = `${deps.pathname}${deps.search}${deps.hash}`;
  if (decision.redirectTo === current) return;
  deps.markLeaving();
  deps.replace(decision.redirectTo);
}

export function routerBasepath(pathname: string, baseUrl: string | undefined): string {
  const place = parsePlace(pathname, baseUrl);
  if (place.lang === 'en') return place.prefix ? `${place.prefix}/en` : '/en';
  return place.prefix || '/';
}

export function pageLang(pathname: string, _search: string, prefix: string | undefined): AppLang {
  return parsePlace(pathname, prefix).lang;
}

export function appHomeHref(
  pathname: string,
  search: string,
  prefix: string | undefined,
  pref: AppLang | null,
): string {
  const place = parsePlace(pathname, prefix);
  const base = place.prefix ? `${place.prefix}/` : '/';
  if (place.lang === 'en') return `${base}en/`;
  return explicitZh(search) && pref !== 'zh' ? `${base}?lang=zh` : base;
}

export function localeUrls(value: string | undefined, origin = PUBLIC_ORIGIN): LocaleUrls {
  const prefix = prefixFromDeployValue(value);
  return {
    prefix,
    zh: `${origin}${prefix}/`,
    en: `${origin}${prefix}/en/`,
  };
}

export function applyLocaleHtml(html: string, urls: LocaleUrls): string {
  return html
    .replaceAll('__EASYPIC_PREFIX__', urls.prefix)
    .replaceAll('__EASYPIC_CANONICAL_ZH__', urls.zh)
    .replaceAll('__EASYPIC_CANONICAL_EN__', urls.en);
}

export function readBrowserPref(): AppLang | null {
  return readManualPref(
    () => localStorage.getItem('rf-lang'),
    () => readCookiePref(document.cookie),
  );
}

export function bootFromBrowser(): void {
  const prefix = document.documentElement.getAttribute('data-easypic-prefix') || '';
  const languages = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  bootLocale({
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    prefix,
    languages,
    pref: readBrowserPref(),
    offersEn: !!document.querySelector('link[rel="alternate"][hreflang="en"]'),
    rfLang: window.rfLang && typeof window.rfLang.enter === 'function' ? window.rfLang : null,
    replace: (url: string) => location.replace(url),
    markLeaving: () => {
      window.__easypicLeaving = true;
    },
  });
}

const BOOT_FNS = [
  normalizePrefix,
  parsePlace,
  explicitZh,
  matchLanguages,
  readCookiePref,
  readManualPref,
  languageQuery,
  languageHref,
  decideEnter,
  bootLocale,
  readBrowserPref,
  bootFromBrowser,
];

export function localeBootSource(): string {
  const body = BOOT_FNS.map((fn) => `const ${fn.name} = ${fn.toString()};`).join('\n');
  return `(() => {\n${body}\nbootFromBrowser();\n})();`;
}
