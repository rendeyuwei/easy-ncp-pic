import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { App } from './app';
import { webBasepath } from './lib/deployment-paths';

const rootRoute = createRootRoute({
  component: Outlet,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: App,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export function createWebRouter(history?: RouterHistory, basepath = webBasepath()) {
  return createRouter({ routeTree, basepath, history });
}

export const router = createWebRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
