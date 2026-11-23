import { createContext, useContext, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { localeUrls, pageLangFromRoute, type AppLang } from './lib/locale';
import { messages, type Messages } from './lib/messages';

const LocaleContext = createContext<AppLang>('zh');
const LocaleSetter = createContext<Dispatch<SetStateAction<AppLang>>>(() => undefined);

export function applyDocumentLocale(lang: AppLang): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  const copy = messages[lang];
  document.title = 'EasyPic';
  document.querySelector('meta[name="description"]')?.setAttribute('content', copy.description);
  const urls = localeUrls(document.documentElement.getAttribute('data-easypic-prefix') || import.meta.env.BASE_URL);
  document.querySelector('link[rel="canonical"]')?.setAttribute('href', lang === 'en' ? urls.en : urls.zh);
}

export function LocaleProvider({ lang = 'zh', children }: { lang?: AppLang; children: ReactNode }) {
  const [current, setCurrent] = useState(lang);
  useLayoutEffect(() => {
    setCurrent(lang);
  }, [lang]);
  useLayoutEffect(() => {
    applyDocumentLocale(current);
  }, [current]);

  return (
    <LocaleSetter.Provider value={setCurrent}>
      <LocaleContext.Provider value={current}>{children}</LocaleContext.Provider>
    </LocaleSetter.Provider>
  );
}

export function LocaleRouteSync(): null {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const setLang = useContext(LocaleSetter);
  const lang = pageLangFromRoute(pathname);
  useLayoutEffect(() => {
    setLang(lang);
  }, [lang, setLang]);
  return null;
}

export function useLang(): AppLang {
  return useContext(LocaleContext);
}

export function useMessages(): Messages {
  return messages[useLang()];
}
