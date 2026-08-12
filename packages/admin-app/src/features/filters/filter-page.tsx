import { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { PageState, StatusBadge } from '../../components/ui/status';
import { useNotifications } from '../../components/notification-provider';
import { ApiFailure } from '../../lib/admin-client';
import type { AdminFilter } from '../../lib/api-schema';
import { useCategories } from '../categories/category-queries';
import { FilterCreateDialog } from './filter-create-dialog';
import { FilterEditDialog } from './filter-edit-dialog';
import { useCreateFilter, useDeleteFilter, useFilters, useUpdateFilter } from './filter-queries';

const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function updatedAt(filter: AdminFilter) {
  return <time dateTime={filter.updatedAt}>{dateFormatter.format(new Date(filter.updatedAt))}</time>;
}

function FilterActions({ filter, onEdit, onDelete }: {
  filter: AdminFilter;
  onEdit(filter: AdminFilter): void;
  onDelete(filter: AdminFilter): void;
}) {
  return (
    <div className="record-actions">
      <Button variant="ghost" size="compact" aria-label={`编辑${filter.displayName}`} onClick={() => onEdit(filter)}><Pencil aria-hidden="true" />编辑</Button>
      <Button variant="danger" size="compact" aria-label={`删除${filter.displayName}`} onClick={() => onDelete(filter)}><Trash2 aria-hidden="true" />删除</Button>
    </div>
  );
}

export function FilterPage() {
  const filters = useFilters();
  const categories = useCategories();
  const create = useCreateFilter();
  const update = useUpdateFilter();
  const remove = useDeleteFilter();
  const { notify } = useNotifications();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminFilter | null>(null);
  const [filterToDelete, setFilterToDelete] = useState<AdminFilter | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteContentRef = useRef<HTMLDivElement>(null);
  const createAvailabilityId = 'filter-create-availability';
  const createUnavailable = !categories.isSuccess;
  const createAvailability = categories.isPending
    ? '正在加载分类，暂时无法新增滤镜。'
    : categories.isError ? '分类加载失败，请重试后新增滤镜。' : null;
  const openCreate = () => {
    if (categories.isSuccess) setCreateOpen(true);
  };
  const categoryNames = useMemo(
    () => new Map((categories.data ?? []).map((category) => [category.id, category.name])),
    [categories.data],
  );
  const openDelete = (filter: AdminFilter) => {
    setFilterToDelete(filter);
    setDeleteError(null);
  };
  const deleteFilter = async () => {
    if (!filterToDelete || remove.isPending) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(filterToDelete.id);
      setFilterToDelete(null);
      notify('滤镜已删除', 'success');
    } catch (error) {
      setDeleteError(error instanceof ApiFailure && error.code === 'RATE_LIMITED'
        ? '请求过于频繁，请稍后重试'
        : '删除失败，请重试');
    }
  };
  useEffect(() => {
    const close = deleteContentRef.current?.querySelector<HTMLButtonElement>('.dialog__close');
    if (close) close.disabled = remove.isPending;
  }, [remove.isPending]);

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
        action={<Button onClick={openCreate}>新增滤镜</Button>}
      />
    );
  } else {
    content = (
      <>
        <table className="data-table filter-table" aria-label="滤镜列表">
          <thead><tr><th>滤镜</th><th>分类</th><th>状态</th><th>排序</th><th>更新时间</th><th>操作</th></tr></thead>
          <tbody>{filters.data.map((filter) => (
            <tr key={filter.id}>
              <td><strong>{filter.displayName}</strong><span className="record-secondary">{filter.sourceName}</span></td>
              <td>{categoryNames.get(filter.categoryId) ?? '未知分类'}</td>
              <td><StatusBadge enabled={filter.isEnabled} /></td>
              <td>{filter.sortOrder}</td>
              <td>{updatedAt(filter)}</td>
              <td><FilterActions filter={filter} onEdit={setEditing} onDelete={openDelete} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="mobile-card-list filter-card-list--stacked">{filters.data.map((filter) => (
          <article className="data-card filter-card" key={filter.id}>
            <h2>{filter.displayName}</h2>
            <p className="record-secondary">{filter.sourceName}</p>
            <dl>
              <div><dt>分类</dt><dd>{categoryNames.get(filter.categoryId) ?? '未知分类'}</dd></div>
              <div><dt>状态</dt><dd><StatusBadge enabled={filter.isEnabled} /></dd></div>
              <div><dt>排序</dt><dd>{filter.sortOrder}</dd></div>
              <div><dt>更新时间</dt><dd>{updatedAt(filter)}</dd></div>
            </dl>
            <FilterActions filter={filter} onEdit={setEditing} onDelete={openDelete} />
          </article>
        ))}</div>
      </>
    );
  }

  return (
    <section className="admin-page">
      <header className="page-heading filter-heading">
        <div>
          <p className="eyebrow">内容管理</p>
          <h1>滤镜</h1>
          <p className="page-heading__copy">检查并发布 NCP，管理展示顺序与状态。</p>
          {createAvailability ? <p id={createAvailabilityId} className="create-availability">{createAvailability}</p> : null}
        </div>
        <Button
          disabled={createUnavailable}
          aria-describedby={createAvailability ? createAvailabilityId : undefined}
          onClick={openCreate}
        ><Plus aria-hidden="true" />新增滤镜</Button>
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
      <FilterEditDialog
        open={editing !== null}
        filter={editing}
        categories={categories.data ?? []}
        mutation={update}
        onOpenChange={(open) => { if (!open) setEditing(null); }}
        onSuccess={() => {
          setEditing(null);
          notify('滤镜已更新', 'success');
        }}
      />
      <Dialog
        open={filterToDelete !== null}
        onOpenChange={(open) => { if (!open && !remove.isPending) setFilterToDelete(null); }}
      >
        <DialogContent ref={deleteContentRef} className={remove.isPending ? 'filter-delete-dialog--pending' : undefined}>
          <DialogHeader>
            <DialogTitle>删除滤镜</DialogTitle>
            <DialogDescription>确定要删除“{filterToDelete?.displayName}”吗？此操作无法撤销。</DialogDescription>
          </DialogHeader>
          {deleteError ? <p className="form-alert confirmation-error" role="alert">{deleteError}</p> : null}
          <DialogFooter>
            <Button variant="ghost" disabled={remove.isPending} onClick={() => setFilterToDelete(null)}>取消</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void deleteFilter()}>删除滤镜</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
