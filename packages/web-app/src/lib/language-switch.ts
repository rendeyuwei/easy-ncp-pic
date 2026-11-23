import { pageLang, parsePlace, type AppLang } from './locale';

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
    const href = sameAppLanguageHref(location.href, link.href, prefix);
    if (!href) return;
    event.preventDefault();
    event.stopPropagation();
    const lang: AppLang = parsePlace(new URL(href, location.href).pathname, prefix).lang;
    try {
      window.rfLang?.choose?.(lang);
    } catch {
      // choose() already tolerates blocked storage; a thrown wrapper still should not block the switch.
    }
    void Promise.resolve(navigate(href)).then(() => {
      replaySharedShell();
    }).catch(() => {
      assign(href);
    });
  };
  document.addEventListener('click', onClick, true);
  window.addEventListener('popstate', replaySharedShell);
  return () => {
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('popstate', replaySharedShell);
  };
}

function replaySharedShell(): void {
  try {
    syncSharedShell();
  } catch {
    // The address has already changed. A failed shell replay must not full-load the page.
  }
}

// Temporary preview adapter. The shared topbar freezes its language at startup
// and only rewrites the toggle href on hashchange. Until the shell publishes its
// own same-document update, replay the existing script so the preview matches
// the URL. This does not add or wrap any rfLang method.
export function syncSharedShell(): void {
  const bar = document.querySelector('.rf-bar');
  if (!bar) return;
  const prefix = document.documentElement.getAttribute('data-easypic-prefix') || import.meta.env.BASE_URL;
  const wanted = pageLang(location.pathname, location.search, prefix);
  const shown: AppLang | null = bar.getAttribute('lang') === 'en' ? 'en' : 'zh';
  if (shown === wanted) return;
  const current = document.querySelector('script[src*="/shell/topbar.js"]');
  if (!(current instanceof HTMLScriptElement)) return;
  bar.remove();
  delete window.__rfBar;
  const next = document.createElement('script');
  next.src = current.src;
  const tool = current.getAttribute('data-tool');
  const home = current.getAttribute('data-home');
  if (tool) next.dataset.tool = tool;
  if (home) next.dataset.home = home;
  current.replaceWith(next);
}
