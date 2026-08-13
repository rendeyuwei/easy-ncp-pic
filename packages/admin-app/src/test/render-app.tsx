import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, type RouterHistory } from '@tanstack/react-router';
import { render, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
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

export function renderAdminApp(api: AdminApi, initialUrl: string): RenderAdminAppResult {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const history = createMemoryHistory({ initialEntries: [initialUrl] });
  const router = createAdminRouter(history);
  const user = userEvent.setup();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NotificationProvider>
          <SessionProvider api={api} queryClient={queryClient}>
            <RouterProvider router={router} />
          </SessionProvider>
        </NotificationProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );

  return { ...view, history, queryClient, router, user };
}
