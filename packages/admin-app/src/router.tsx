import {
  Navigate,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppBoundary } from './components/app-boundary';
import { AdminShell } from './components/admin-shell';
import { LoginPage } from './components/login-page';
import { PageState } from './components/ui/status';
import { useSession } from './session/session-provider';

function RootLayout() {
  return <AppBoundary><Outlet /></AppBoundary>;
}

function IndexRedirect() {
  const { status } = useSession();
  if (status === 'transitioning') return <PageState kind="loading" />;
  return <Navigate to={status === 'authenticated' ? '/filters' : '/login'} replace />;
}

function ProtectedLayout() {
  const { status } = useSession();
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  if (status !== 'authenticated') return <PageState kind="loading" />;
  return <AdminShell />;
}

function FilterRoutePlaceholder() {
  return <section className="admin-page"><header className="page-heading"><div><p className="eyebrow">内容管理</p><h1>滤镜</h1></div></header></section>;
}

function CategoryRoutePlaceholder() {
  return <section className="admin-page"><header className="page-heading"><div><p className="eyebrow">内容管理</p><h1>分类</h1></div></header></section>;
}

function NotFoundRedirect() {
  const { status } = useSession();
  if (status === 'loading' || status === 'transitioning') return <PageState kind="loading" />;
  return <Navigate to={status === 'authenticated' ? '/filters' : '/login'} replace />;
}

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundRedirect,
});

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: IndexRedirect });
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage });
const protectedRoute = createRoute({ getParentRoute: () => rootRoute, id: '_protected', component: ProtectedLayout });
const filtersRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/filters', component: FilterRoutePlaceholder });
const categoriesRoute = createRoute({ getParentRoute: () => protectedRoute, path: '/categories', component: CategoryRoutePlaceholder });

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  protectedRoute.addChildren([filtersRoute, categoriesRoute]),
]);

export function createAdminRouter(history?: RouterHistory) {
  return createRouter({ routeTree, basepath: '/admin', history });
}

export type AdminRouter = ReturnType<typeof createAdminRouter>;
