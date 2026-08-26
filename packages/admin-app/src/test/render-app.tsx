import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, type RouterHistory } from '@tanstack/react-router';
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode } from 'react';
import type { AdminApi } from '../lib/admin-client';
import { createAdminRouter, type AdminRouter } from '../router';
import { SessionProvider } from '../session/session-provider';
import { ThemeProvider } from '../theme/theme-provider';
import { NotificationProvider } from '../components/notification-provider';

interface RenderAdminAppResult extends RenderResult {
  history: RouterHistory;
  queryClient: QueryClient;
  router: AdminRouter;
  user: UserEvent;
}

export function renderAdminApp(
  api: AdminApi,
  initialUrl: string,
  strictMode = false,
  basepath?: string,
): RenderAdminAppResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  const router = createAdminRouter(history, basepath);
  const user = userEvent.setup();

  const app = (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NotificationProvider>
          <SessionProvider api={api} queryClient={queryClient}>
            <RouterProvider router={router} />
          </SessionProvider>
        </NotificationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(strictMode ? <StrictMode>{app}</StrictMode> : app);

  return { ...view, history, queryClient, router, user };
}
