import { QueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, type AdminApi, type Credentials } from '../lib/admin-client';
import { SessionProvider, useSession } from '../session/session-provider';

const credentials: Credentials = { username: 'admin', password: 'secret' };

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((next) => { resolve = next; }), resolve };
}

function createApi(overrides: Partial<AdminApi> = {}) {
  let unauthorizedHandler: () => void = () => undefined;
  const api: AdminApi = {
    setUnauthorizedHandler: (handler) => { unauthorizedHandler = handler; },
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
  return { api, unauthorized: () => unauthorizedHandler() };
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
});
