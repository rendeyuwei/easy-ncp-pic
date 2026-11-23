import { languageHref, normalizePrefix, parsePlace, type AppLang } from './locale';

export function sameAppLanguageHref(currentHref: string, targetHref: string, prefix: string): string | null {
  let current: URL;
  let target: URL;
  try {
    current = new URL(currentHref);
    target = new URL(targetHref, current);
  } catch {
    return null;
  }
  if (target.origin !== current.origin) return null;
  const here = parsePlace(current.pathname, prefix);
  const next = parsePlace(target.pathname, prefix);
  if (here.prefix !== next.prefix || here.lang === next.lang || here.rest !== next.rest) return null;
  return `${target.pathname}${target.search}${target.hash}`;
}

export function plainActivation(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
    && !event.defaultPrevented;
}

function anchorFromEvent(event: MouseEvent): HTMLAnchorElement | null {
  const target = event.target;
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  const link = element?.closest('a');
  return link instanceof HTMLAnchorElement ? link : null;
}

export function installLanguageSwitch(
  navigate: (href: string) => Promise<void> | void,
  prefix = import.meta.env.BASE_URL,
  assign: (href: string) => void = (href) => location.assign(href),
): () => void {
  const onClick = (event: MouseEvent): void => {
    if (!plainActivation(event)) return;
    const link = anchorFromEvent(event);
    if (!link || !link.classList.contains('rf-lang') || link.target === '_blank' || link.hasAttribute('download')) return;
    const href = languageToggleHref(location.href, link.href, prefix);
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    const lang: AppLang = parsePlace(new URL(href, location.href).pathname, prefix).lang;
    try {
      window.rfLang?.choose?.(lang);
    } catch {
      // choose() already tolerates blocked storage; a thrown wrapper still should not block the switch.
    }
    void Promise.resolve(navigate(href)).catch(() => {
      assign(href);
    });
  };
  document.addEventListener('click', onClick, true);
  return () => {
    document.removeEventListener('click', onClick, true);
  };
}

// The shared shell's place() only knows its own site list. On another prefix it
// classifies the page as the home site and builds a URL such as /en/pics/en/.
// Keep that click inside this app. Do not replay topbar.js or touch __rfBar;
// the shared mount contract is not published yet.
export function languageToggleHref(currentHref: string, targetHref: string, prefix: string): string | null {
  const sibling = sameAppLanguageHref(currentHref, targetHref, prefix);
  if (sibling) return sibling;
  if (!targetLeavesApp(currentHref, targetHref, prefix)) return null;
  let current: URL;
  try {
    current = new URL(currentHref);
  } catch {
    return null;
  }
  const here = parsePlace(current.pathname, prefix);
  return languageHref(here, here.lang === 'en' ? 'zh' : 'en', current.search, current.hash);
}

function targetLeavesApp(currentHref: string, targetHref: string, prefix: string): boolean {
  let target: URL;
  try {
    target = new URL(targetHref, currentHref);
    const current = new URL(currentHref);
    if (target.origin !== current.origin) return true;
  } catch {
    return true;
  }
  const normalized = normalizePrefix(prefix);
  if (!normalized) return false;
  const path = target.pathname;
  return path !== normalized && path !== `${normalized}/` && !path.startsWith(`${normalized}/`);
}
