import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import type { AppLang } from './lib/locale';
import { messages, type Messages } from './lib/messages';

const LocaleContext = createContext<AppLang>('zh');

export function LocaleProvider({ lang, children }: { lang: AppLang; children: ReactNode }) {
  useLayoutEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  }, [lang]);

  return <LocaleContext.Provider value={lang}>{children}</LocaleContext.Provider>;
}

export function useLang(): AppLang {
  return useContext(LocaleContext);
}

export function useMessages(): Messages {
  return messages[useLang()];
}
