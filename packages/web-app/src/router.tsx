import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  type RouterHistory,
} from '@tanstack/react-router';
import { App } from './app';
import { deploymentBasepath } from './lib/locale';
import { LocaleRouteSync } from './locale-context';

function AppLayout() {
  return (
    <>
      <LocaleRouteSync />
      <App />
      <Outlet />
    </>
  );
}

const rootRoute = createRootRoute({
  component: Outlet,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppLayout,
});

const chineseRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => null,
});

const englishRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/en',
  component: () => null,
});

const routeTree = rootRoute.addChildren([
  appRoute.addChildren([chineseRoute, englishRoute]),
]);

export function createWebRouter(
  history?: RouterHistory,
  basepath = deploymentBasepath(import.meta.env.BASE_URL),
) {
  return createRouter({
    routeTree,
    basepath,
    history,
    trailingSlash: 'preserve',
  });
}

export const router = createWebRouter();

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
