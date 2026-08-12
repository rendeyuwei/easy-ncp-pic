import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { PageState, StatusBadge } from '../../components/ui/status';
import { useNotifications } from '../../components/notification-provider';
import type { AdminFilter } from '../../lib/api-schema';
import { useCategories } from '../categories/category-queries';
import { FilterCreateDialog } from './filter-create-dialog';
import { useCreateFilter, useFilters } from './filter-queries';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function updatedAt(filter: AdminFilter) {
  return <time dateTime={filter.updatedAt}>{dateFormatter.format(new Date(filter.updatedAt))}</time>;
}

export function FilterPage() {
  const filters = useFilters();
  const categories = useCategories();
  const create = useCreateFilter();
  const { notify } = useNotifications();
  const [createOpen, setCreateOpen] = useState(false);
  const categoryNames = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  );

  let content;
  if (filters.isPending || categories.isPending) {
    content = <PageState kind="loading" title="正在加载滤镜…" />;
  } else if (filters.isError || categories.isError) {
    content = (
      <PageState
        kind="error"
        title="无法加载滤镜"
        message="管理服务暂时不可用。"
        action={<Button onClick={() => void Promise.all([filters.refetch(), categories.refetch()])}>重试</Button>}
      />
    );
  } else if (!filters.data.length) {
    content = (
      <PageState
        kind="empty"
        title="暂无滤镜"
        message="检查并发布第一个 NCP 滤镜。"
        action={<Button onClick={() => setCreateOpen(true)}>新增滤镜</Button>}
      />
    );
  } else {
    content = (
      <>
        <table className="data-table filter-table" aria-label="滤镜列表">
          <thead><tr><th>滤镜</th><th>分类</th><th>状态</th><th>排序</th><th>更新时间</th></tr></thead>
          <tbody>{filters.data.map((filter) => (
            <tr key={filter.id}>
              <td><strong>{filter.displayName}</strong><span className="record-secondary">{filter.sourceName}</span></td>
              <td>{categoryNames.get(filter.categoryId) ?? '未知分类'}</td>
              <td><StatusBadge enabled={filter.isEnabled} /></td>
              <td>{filter.sortOrder}</td>
              <td>{updatedAt(filter)}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className="mobile-card-list">{filters.data.map((filter) => (
          <article className="data-card filter-card" key={filter.id}>
            <h2>{filter.displayName}</h2>
            <p className="record-secondary">{filter.sourceName}</p>
            <dl>
              <div><dt>分类</dt><dd>{categoryNames.get(filter.categoryId) ?? '未知分类'}</dd></div>
              <div><dt>状态</dt><dd><StatusBadge enabled={filter.isEnabled} /></dd></div>
              <div><dt>排序</dt><dd>{filter.sortOrder}</dd></div>
              <div><dt>更新时间</dt><dd>{updatedAt(filter)}</dd></div>
            </dl>
          </article>
        ))}</div>
      </>
    );
  }

  return (
    <section className="admin-page">
      <header className="page-heading filter-heading">
        <div><p className="eyebrow">内容管理</p><h1>滤镜</h1><p className="page-heading__copy">检查并发布 NCP，管理展示顺序与状态。</p></div>
        <Button onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" />新增滤镜</Button>
      </header>
      {content}
      <FilterCreateDialog
        open={createOpen}
        categories={categories.data ?? []}
        mutation={create}
        onOpenChange={setCreateOpen}
        onSuccess={() => {
          setCreateOpen(false);
          notify('滤镜已创建', 'success');
        }}
      />
    </section>
  );
}
