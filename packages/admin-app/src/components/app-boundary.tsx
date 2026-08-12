import type { PropsWithChildren } from 'react';
import { useSession } from '../session/session-provider';
import { Button } from './ui/button';
import { PageState } from './ui/status';

export function AppBoundary({ children }: PropsWithChildren) {
  const { status, bootstrapError, retryBootstrap } = useSession();

  if (status === 'loading' && bootstrapError) {
    return (
      <main className="boundary-page">
        <PageState
          kind="error"
          title="无法连接管理服务"
          message="请检查网络连接后重试。"
          action={<Button onClick={() => void retryBootstrap()}>重试</Button>}
        />
      </main>
    );
  }

  if (status === 'loading') {
    return <main className="boundary-page"><PageState kind="loading" /></main>;
  }

  return children;
}
