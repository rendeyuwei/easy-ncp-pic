import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { installLanguageSwitch } from './lib/language-switch';
import { pageLang } from './lib/locale';
import { applyDocumentLocale, LocaleProvider } from './locale-context';
import { router } from './router';
import './styles.css';

installLanguageSwitch(async (href) => {
  await router.navigate({
    href,
    resetScroll: false,
    hashScrollIntoView: false,
  });
  applyDocumentLocale(pageLang(window.location.pathname, window.location.search, import.meta.env.BASE_URL));
});

const queryClient = new QueryClient();
const lang = pageLang(window.location.pathname, window.location.search, import.meta.env.BASE_URL);
const root = document.getElementById('root');

if (!root) throw new Error('Unable to find the application root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider lang={lang}>
        <RouterProvider router={router} />
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);
