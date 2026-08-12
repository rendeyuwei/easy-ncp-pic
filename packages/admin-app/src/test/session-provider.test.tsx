import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, type AdminApi, type Credentials } from '../lib/admin-client';
import { SessionProvider, useSession } from '../session/session-provider';

const credentials: Credentials = { username: 'admin', password: 'secret' };

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(reason: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  return { promise: new Promise<T>((next, fail) => { resolve = next; reject = fail; }), resolve, reject };
}

function createApi(overrides: Partial<AdminApi> = {}) {
  let unauthorizedHandler: () => void = () => undefined;
  const unauthorizedHandlers: Array<() => void> = [];
  const api: AdminApi = {
    setUnauthorizedHandler: (handler) => { unauthorizedHandler = handler; unauthorizedHandlers.push(handler); },
    restoreSession: async () => undefined,
    login: async () => undefined,
    logout: async () => undefined,
    listCategories: async () => [],
    createCategory: async () => { throw new Error('not used'); },
    updateCategory: async () => { throw new Error('not used'); },
    deleteCategory: async () => undefined,
    listFilters: async () => [],
    createFilter: async () => { throw new Error('not used'); },
    updateFilter: async () => { throw new Error('not used'); },
    deleteFilter: async () => undefined,
    ...overrides,
  };
  return {
    api,
    unauthorized: () => unauthorizedHandler(),
    unauthorizedAt: (index: number) => unauthorizedHandlers[index](),
  };
}

let current: ReturnType<typeof useSession>;

function SessionProbe() {
  const session = useSession();
  useEffect(() => { current = session; }, [session]);
  return (
    <>
      <output>{session.status}</output>
      {session.bootstrapError ? <p>{session.bootstrapError}</p> : null}
      <button onClick={() => void session.login(credentials)}>login</button>
      <button onClick={() => void session.logout()}>logout</button>
      <button onClick={() => void session.retryBootstrap()}>retry</button>
    </>
  );
}

function renderSession(api: AdminApi, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  render(<SessionProvider api={api} queryClient={queryClient}><SessionProbe /></SessionProvider>);
  return queryClient;
}

function preloadProtectedQueries(queryClient: QueryClient) {
  queryClient.setQueryData(['admin', 'categories'], ['cached-category']);
  queryClient.setQueryData(['admin', 'filters'], ['cached-filter']);
}

function expectProtectedQueriesRemoved(queryClient: QueryClient) {
  expect(queryClient.getQueryData(['admin', 'categories'])).toBeUndefined();
  expect(queryClient.getQueryData(['admin', 'filters'])).toBeUndefined();
}

describe('SessionProvider', () => {
  it('bootstraps once from loading to authenticated', async () => {
    const restoreSession = vi.fn(async () => undefined);
    renderSession(createApi({ restoreSession }).api);

    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());
    expect(restoreSession).toHaveBeenCalledTimes(1);
  });

  it('becomes anonymous when restoration rejects with ApiFailure 401', async () => {
    renderSession(createApi({ restoreSession: async () => { throw new ApiFailure(401, 'UNAUTHORIZED', 'Sign in'); } }).api);

    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
    expect(current.bootstrapError).toBeNull();
  });

  it('keeps a retryable restoration failure loading until retry succeeds', async () => {
    const restoreSession = vi.fn()
      .mockRejectedValueOnce(new ApiFailure(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(undefined);
    renderSession(createApi({ restoreSession }).api);

    await waitFor(() => expect(screen.getByText('loading')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('无法恢复登录状态，请重试')).toBeInTheDocument());
    await act(async () => { await current.retryBootstrap(); });

    expect(screen.getByText('authenticated')).toBeInTheDocument();
    expect(restoreSession).toHaveBeenCalledTimes(2);
  });

  it('treats only an ApiFailure 401 as anonymous during restoration', async () => {
    renderSession(createApi({ restoreSession: async () => { throw { status: 401 }; } }).api);

    await waitFor(() => expect(screen.getByText('无法恢复登录状态，请重试')).toBeInTheDocument());
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('transitions during login and becomes authenticated after login succeeds', async () => {
    const login = deferred<void>();
    renderSession(createApi({ login: () => login.promise }).api);
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());

    let loginPromise!: Promise<void>;
    act(() => { loginPromise = current.login(credentials); });
    expect(screen.getByText('transitioning')).toBeInTheDocument();
    login.resolve(undefined);
    await act(async () => { await loginPromise; });

    expect(screen.getByText('authenticated')).toBeInTheDocument();
  });

  it('restores the previous anonymous state and rethrows when login fails', async () => {
    renderSession(createApi({
      restoreSession: async () => { throw new ApiFailure(401, 'UNAUTHORIZED', 'Sign in'); },
      login: async () => { throw new ApiFailure(0, 'NETWORK_ERROR', 'offline'); },
    }).api);
    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());

    await expect(act(async () => { await current.login(credentials); })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
  });

  it('logs out to anonymous and removes all protected query cache', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    preloadProtectedQueries(queryClient);
    renderSession(createApi().api, queryClient);
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());

    await act(async () => { await current.logout(); });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expectProtectedQueriesRemoved(queryClient);
  });

  it('stays transitioning while a deferred logout is pending', async () => {
    const logout = deferred<void>();
    renderSession(createApi({ logout: () => logout.promise }).api);
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());

    let logoutPromise!: Promise<void>;
    act(() => { logoutPromise = current.logout(); });

    expect(screen.getByText('transitioning')).toBeInTheDocument();
    logout.resolve(undefined);
    await act(async () => { await logoutPromise; });
  });

  it('keeps authenticated state and cache when logout has a recoverable failure', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    preloadProtectedQueries(queryClient);
    renderSession(createApi({ logout: async () => { throw new ApiFailure(0, 'NETWORK_ERROR', 'offline'); } }).api, queryClient);
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());

    await expect(act(async () => { await current.logout(); })).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    expect(screen.getByText('authenticated')).toBeInTheDocument();
    expect(queryClient.getQueryData(['admin', 'categories'])).toEqual(['cached-category']);
    expect(queryClient.getQueryData(['admin', 'filters'])).toEqual(['cached-filter']);
  });

  it('handles the client unauthorized callback by clearing cache and becoming anonymous', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    preloadProtectedQueries(queryClient);
    const fake = createApi();
    renderSession(fake.api, queryClient);
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());

    await act(async () => { fake.unauthorized(); });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expectProtectedQueriesRemoved(queryClient);
  });

  it('does not roll back an unauthorized callback when logout then rejects', async () => {
    const logout = deferred<void>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    preloadProtectedQueries(queryClient);
    const fake = createApi({ logout: () => {
      fake.unauthorized();
      return logout.promise;
    } });
    renderSession(fake.api, queryClient);
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());

    let logoutPromise!: Promise<void>;
    act(() => { logoutPromise = current.logout(); });
    logout.reject(new ApiFailure(401, 'UNAUTHORIZED', 'Sign in'));
    await expect(act(async () => { await logoutPromise; })).rejects.toMatchObject({ status: 401 });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expectProtectedQueriesRemoved(queryClient);
  });

  it('makes a stale unauthorized callback inert after api and query client replacement', async () => {
    const firstRestoration = deferred<void>();
    const first = createApi({ restoreSession: () => firstRestoration.promise });
    const second = createApi({ restoreSession: async () => { throw new ApiFailure(401, 'UNAUTHORIZED', 'Sign in'); } });
    const firstQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const secondQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    preloadProtectedQueries(firstQueryClient);
    preloadProtectedQueries(secondQueryClient);
    const view = render(<SessionProvider api={first.api} queryClient={firstQueryClient}><SessionProbe /></SessionProvider>);

    view.rerender(<SessionProvider api={second.api} queryClient={secondQueryClient}><SessionProbe /></SessionProvider>);
    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
    await act(async () => { first.unauthorizedAt(0); });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
    expect(firstQueryClient.getQueryData(['admin', 'categories'])).toEqual(['cached-category']);
    expect(firstQueryClient.getQueryData(['admin', 'filters'])).toEqual(['cached-filter']);
  });

  it('does not let an old bootstrap authenticate a replacement generation', async () => {
    const firstRestoration = deferred<void>();
    const first = createApi({ restoreSession: () => firstRestoration.promise });
    const second = createApi({ restoreSession: async () => { throw new ApiFailure(401, 'UNAUTHORIZED', 'Sign in'); } });
    const firstQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const secondQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<SessionProvider api={first.api} queryClient={firstQueryClient}><SessionProbe /></SessionProvider>);

    view.rerender(<SessionProvider api={second.api} queryClient={secondQueryClient}><SessionProbe /></SessionProvider>);
    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
    firstRestoration.resolve(undefined);
    await act(async () => { await firstRestoration.promise; });

    expect(screen.getByText('anonymous')).toBeInTheDocument();
  });

  it('keeps cache intact when deferred bootstrap completes after unmount', async () => {
    const restoration = deferred<void>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    preloadProtectedQueries(queryClient);
    const fake = createApi();
    fake.api.restoreSession = async () => {
      await restoration.promise;
      fake.unauthorizedAt(0);
      throw new ApiFailure(401, 'UNAUTHORIZED', 'Sign in');
    };
    const view = render(<SessionProvider api={fake.api} queryClient={queryClient}><SessionProbe /></SessionProvider>);

    view.unmount();
    restoration.resolve(undefined);
    await act(async () => { await restoration.promise; });

    expect(queryClient.getQueryData(['admin', 'categories'])).toEqual(['cached-category']);
    expect(queryClient.getQueryData(['admin', 'filters'])).toEqual(['cached-filter']);
  });

  it('keeps cache intact when deferred logout completes after unmount', async () => {
    const logout = deferred<void>();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    preloadProtectedQueries(queryClient);
    const view = render(<SessionProvider api={createApi({ logout: () => logout.promise }).api} queryClient={queryClient}><SessionProbe /></SessionProvider>);
    await waitFor(() => expect(screen.getByText('authenticated')).toBeInTheDocument());

    let logoutPromise!: Promise<void>;
    act(() => { logoutPromise = current.logout(); });
    view.unmount();
    logout.resolve(undefined);
    await act(async () => { await logoutPromise; });

    expect(queryClient.getQueryData(['admin', 'categories'])).toEqual(['cached-category']);
    expect(queryClient.getQueryData(['admin', 'filters'])).toEqual(['cached-filter']);
  });
});
