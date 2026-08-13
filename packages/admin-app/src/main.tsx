import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { NotificationProvider } from './components/notification-provider';
import { AdminApiClient } from './lib/admin-client';
import { createAdminRouter } from './router';
import { SessionProvider } from './session/session-provider';
import { ThemeProvider } from './theme/theme-provider';
import './styles.css';

const api = new AdminApiClient();
const queryClient = new QueryClient();
const router = createAdminRouter();
const root = document.getElementById('root');

if (!root) throw new Error('Unable to find the application root');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NotificationProvider>
          <SessionProvider api={api} queryClient={queryClient}>
            <RouterProvider router={router} />
          </SessionProvider>
        </NotificationProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
