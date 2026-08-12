import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiFailure, type AdminApi, type Credentials } from '../lib/admin-client';
import { queryKeys } from '../features/query-keys';

export type SessionStatus = 'loading' | 'authenticated' | 'anonymous' | 'transitioning';

interface SessionContextValue {
  status: SessionStatus;
  bootstrapError: string | null;
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
  const mounted = useRef(false);
  const generation = useRef(0);
  const authTransition = useRef(0);

  const isCurrent = useCallback((operationGeneration: number) => (
    mounted.current && generation.current === operationGeneration
  ), []);

  const becomeAnonymous = useCallback((operationGeneration: number, operationQueryClient: QueryClient) => {
    if (!isCurrent(operationGeneration)) return false;
    authTransition.current += 1;
    operationQueryClient.removeQueries({ queryKey: queryKeys.root });
    setStatus('anonymous');
    setBootstrapError(null);
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
        setStatus('authenticated');
      }
    } catch (error) {
      if (!isCurrent(operationGeneration) || authTransition.current !== operationAuthTransition) return;
      if (error instanceof ApiFailure && error.status === 401) {
        becomeAnonymous(operationGeneration, operationQueryClient);
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
    api.setUnauthorizedHandler(() => { becomeAnonymous(effectGeneration, queryClient); });
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
    try {
      await api.login(input);
      if (isCurrent(operationGeneration) && authTransition.current === operationAuthTransition) {
        setStatus('authenticated');
        setBootstrapError(null);
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
      becomeAnonymous(operationGeneration, queryClient);
    } catch (error) {
      if (isCurrent(operationGeneration) && authTransition.current === operationAuthTransition) setStatus(previous);
      throw error;
    }
  }, [api, becomeAnonymous, isCurrent, queryClient, status]);

  const value = useMemo<SessionContextValue>(() => ({ status, bootstrapError, api, retryBootstrap, login, logout }), [api, bootstrapError, login, logout, retryBootstrap, status]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used within SessionProvider');
  return session;
}
