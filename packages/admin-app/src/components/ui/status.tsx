import type { ReactNode } from 'react';
import { clsx } from 'clsx';

type PageStateKind = 'loading' | 'error' | 'empty';

interface PageStateProps {
  kind: PageStateKind;
  title?: string;
  message?: string;
  action?: ReactNode;
}

const defaultCopy: Record<PageStateKind, { title: string; message: string }> = {
  loading: { title: '正在加载…', message: '请稍候。' },
  error: { title: '加载失败', message: '请稍后重试。' },
  empty: { title: '暂无内容', message: '这里还没有可显示的内容。' },
};

export function PageState({ kind, title, message, action }: PageStateProps) {
  const copy = defaultCopy[kind];
  return (
    <section className={clsx('page-state', `page-state--${kind}`)} aria-live={kind === 'loading' ? 'polite' : undefined}>
      <h2>{title ?? copy.title}</h2>
      <p>{message ?? copy.message}</p>
      {action ? <div className="page-state__action">{action}</div> : null}
    </section>
  );
}

export function StatusBadge({ enabled }: { enabled: boolean }) {
  return (
    <span className={clsx('status-badge', enabled ? 'status-badge--enabled' : 'status-badge--disabled')}>
      {enabled ? '已启用' : '已停用'}
    </span>
  );
}
