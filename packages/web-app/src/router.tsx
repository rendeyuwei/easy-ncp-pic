import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { App } from './app';
import { routerBasepath } from './lib/locale';

const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export function createWebRouter(
  history?: RouterHistory,
  basepath = routerBasepath(
    typeof window === 'undefined' ? '/' : window.location.pathname,
    import.meta.env.BASE_URL,
  ),
) {
  return createRouter({ routeTree, basepath, history });
}

export const router = createWebRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
