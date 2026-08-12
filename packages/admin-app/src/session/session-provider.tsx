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
  const active = useRef(true);

  const becomeAnonymous = useCallback(() => {
    queryClient.removeQueries({ queryKey: queryKeys.root });
    if (active.current) {
      setStatus('anonymous');
      setBootstrapError(null);
    }
  }, [queryClient]);

  const retryBootstrap = useCallback(async () => {
    if (active.current) {
      setStatus('loading');
      setBootstrapError(null);
    }

    try {
      await api.restoreSession();
      if (active.current) setStatus('authenticated');
    } catch (error) {
      if (!active.current) return;
      if (error instanceof ApiFailure && error.status === 401) {
        becomeAnonymous();
        return;
      }
      setStatus('loading');
      setBootstrapError('无法恢复登录状态，请重试');
    }
  }, [api, becomeAnonymous]);

  useEffect(() => {
    active.current = true;
    api.setUnauthorizedHandler(becomeAnonymous);
    void retryBootstrap();
    return () => {
      active.current = false;
      api.setUnauthorizedHandler(() => undefined);
    };
  }, [api, becomeAnonymous, retryBootstrap]);

  const login = useCallback(async (input: Credentials) => {
    const previous = status === 'transitioning' ? 'anonymous' : status;
    setStatus('transitioning');
    try {
      await api.login(input);
      if (active.current) {
        setStatus('authenticated');
        setBootstrapError(null);
      }
    } catch (error) {
      if (active.current) setStatus(previous);
      throw error;
    }
  }, [api, status]);

  const logout = useCallback(async () => {
    const previous = status === 'transitioning' ? 'authenticated' : status;
    setStatus('transitioning');
    try {
      await api.logout();
      becomeAnonymous();
    } catch (error) {
      if (active.current) setStatus(previous);
      throw error;
    }
  }, [api, becomeAnonymous, status]);

  const value = useMemo<SessionContextValue>(() => ({ status, bootstrapError, api, retryBootstrap, login, logout }), [api, bootstrapError, login, logout, retryBootstrap, status]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used within SessionProvider');
  return session;
}
