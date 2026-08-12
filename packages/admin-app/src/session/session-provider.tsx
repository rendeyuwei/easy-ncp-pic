import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiFailure, type AdminApi, type Credentials } from '../lib/admin-client';
import { queryKeys } from '../features/query-keys';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous' | 'transitioning';

interface SessionContextValue {
  status: SessionStatus;
  bootstrapError: string | null;
  expiryNotice: string | null;
  api: AdminApi;
  retryBootstrap(): Promise<void>;
  login(input: Credentials): Promise<void>;
  logout(): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps extends PropsWithChildren {
  api: AdminApi;
  queryClient: QueryClient;
}

export function SessionProvider({ api, queryClient, children }: SessionProviderProps) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [expiryNotice, setExpiryNotice] = useState<string | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const authTransition = useRef(0);
  const hasAuthenticatedSession = useRef(false);

  const isCurrent = useCallback((operationGeneration: number) => (
    mounted.current && generation.current === operationGeneration
  ), []);

  const becomeAnonymous = useCallback((
    operationGeneration: number,
    operationQueryClient: QueryClient,
    expired = false,
  ) => {
    if (!isCurrent(operationGeneration)) return false;
    authTransition.current += 1;
    hasAuthenticatedSession.current = false;
    operationQueryClient.removeQueries({ queryKey: queryKeys.root });
    setStatus('anonymous');
    setBootstrapError(null);
    setExpiryNotice(expired ? '登录状态已过期，请重新登录。' : null);
    return true;
  }, [isCurrent]);

  const bootstrap = useCallback(async (
    operationGeneration: number,
    operationApi: AdminApi,
    operationQueryClient: QueryClient,
  ) => {
    if (!isCurrent(operationGeneration)) return;
    const operationAuthTransition = authTransition.current;
    setStatus('loading');
    setBootstrapError(null);

    try {
      await operationApi.restoreSession();
      if (isCurrent(operationGeneration) && authTransition.current === operationAuthTransition) {
        hasAuthenticatedSession.current = true;
        setStatus('authenticated');
        setExpiryNotice(null);
      }
    } catch (error) {
      if (!isCurrent(operationGeneration) || authTransition.current !== operationAuthTransition) return;
      if (error instanceof ApiFailure && error.status === 401) {
        becomeAnonymous(operationGeneration, operationQueryClient, false);
        return;
      }
      setStatus('loading');
      setBootstrapError('无法恢复登录状态，请重试');
    }
  }, [becomeAnonymous, isCurrent]);

  useEffect(() => {
    const effectGeneration = generation.current + 1;
    generation.current = effectGeneration;
    mounted.current = true;
    hasAuthenticatedSession.current = false;
    setExpiryNotice(null);
    api.setUnauthorizedHandler(() => {
      becomeAnonymous(effectGeneration, queryClient, hasAuthenticatedSession.current);
    });
    void bootstrap(effectGeneration, api, queryClient);

    return () => {
      if (generation.current === effectGeneration) generation.current += 1;
      mounted.current = false;
      api.setUnauthorizedHandler(() => undefined);
    };
  }, [api, bootstrap, becomeAnonymous, queryClient]);

  const retryBootstrap = useCallback(() => (
    bootstrap(generation.current, api, queryClient)
  ), [api, bootstrap, queryClient]);

  const login = useCallback(async (input: Credentials) => {
    const operationGeneration = generation.current;
    const operationAuthTransition = authTransition.current;
    const previous = status === 'transitioning' ? 'anonymous' : status;
    if (!isCurrent(operationGeneration)) return;
    setStatus('transitioning');
    setExpiryNotice(null);
    try {
      await api.login(input);
      if (isCurrent(operationGeneration) && authTransition.current === operationAuthTransition) {
        hasAuthenticatedSession.current = true;
        setStatus('authenticated');
        setBootstrapError(null);
        setExpiryNotice(null);
      }
    } catch (error) {
      if (isCurrent(operationGeneration) && authTransition.current === operationAuthTransition) setStatus(previous);
      throw error;
    }
  }, [api, isCurrent, status]);

  const logout = useCallback(async () => {
    const operationGeneration = generation.current;
    const operationAuthTransition = authTransition.current;
    const previous = status === 'transitioning' ? 'authenticated' : status;
    if (!isCurrent(operationGeneration)) return;
    setStatus('transitioning');
    try {
      await api.logout();
      if (isCurrent(operationGeneration) && authTransition.current !== operationAuthTransition) return;
      becomeAnonymous(operationGeneration, queryClient, false);
    } catch (error) {
      if (isCurrent(operationGeneration) && authTransition.current !== operationAuthTransition) return;
      if (isCurrent(operationGeneration) && authTransition.current === operationAuthTransition) setStatus(previous);
      throw error;
    }
  }, [api, becomeAnonymous, isCurrent, queryClient, status]);

  const value = useMemo<SessionContextValue>(() => ({
    status,
    bootstrapError,
    expiryNotice,
    api,
    retryBootstrap,
    login,
    logout,
  }), [api, bootstrapError, expiryNotice, login, logout, retryBootstrap, status]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used within SessionProvider');
  return session;
}
