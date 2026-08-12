import { useState } from 'react';
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
import { ApiFailure, type CategoryInput } from '../../lib/admin-client';
import type { AdminCategory } from '../../lib/api-schema';
import { CategoryFormDialog } from './category-form-dialog';
import { useCategories, useCreateCategory, useDeleteCategory, useUpdateCategory } from './category-queries';

function CategoryActions({ category, onEdit, onDelete }: {
  category: AdminCategory;
  onEdit(category: AdminCategory): void;
  onDelete(category: AdminCategory): void;
}) {
  return (
    <div className="record-actions">
      <Button variant="ghost" size="compact" aria-label={`编辑${category.name}`} onClick={() => onEdit(category)}><Pencil aria-hidden="true" />编辑</Button>
      <Button variant="danger" size="compact" aria-label={`删除${category.name}`} onClick={() => onDelete(category)}><Trash2 aria-hidden="true" />删除</Button>
    </div>
  );
}

export function CategoryPage() {
  const categories = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();
  const { notify } = useNotifications();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [deleting, setDeleting] = useState<AdminCategory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const openCreate = () => { setEditing(null); setFormOpen(true); };
  const openEdit = (category: AdminCategory) => { setEditing(category); setFormOpen(true); };
  const openDelete = (category: AdminCategory) => { setDeleting(category); setDeleteError(null); };
  const mutation = editing
    ? update
    : create;

  const deleteCategory = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await remove.mutateAsync(deleting.id);
      setDeleting(null);
      notify('分类已删除', 'success');
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'CATEGORY_IN_USE') {
        setDeleteError('请先移动或删除该分类下的滤镜，然后再删除分类。');
      } else if (error instanceof ApiFailure && error.code === 'RATE_LIMITED') {
        setDeleteError('请求过于频繁，请稍后重试');
      } else {
        setDeleteError('删除失败，请重试');
      }
    }
  };

  let content;
  if (categories.isPending) {
    content = <PageState kind="loading" title="正在加载分类…" />;
  } else if (categories.isError) {
    content = <PageState kind="error" title="无法加载分类" message="管理服务暂时不可用。" action={<Button onClick={() => void categories.refetch()}>重试</Button>} />;
  } else if (!categories.data.length) {
    content = <PageState kind="empty" title="暂无分类" message="创建第一个分类后即可组织滤镜。" action={<Button onClick={openCreate}>新增分类</Button>} />;
  } else {
    content = (
      <>
        <table className="data-table" aria-label="分类列表">
          <thead><tr><th>名称</th><th>Slug</th><th>状态</th><th>排序</th><th>操作</th></tr></thead>
          <tbody>{categories.data.map((category) => (
            <tr key={category.id}>
              <td><strong>{category.name}</strong></td>
              <td><code>{category.slug}</code></td>
              <td><StatusBadge enabled={category.isEnabled} /></td>
              <td>{category.sortOrder}</td>
              <td><CategoryActions category={category} onEdit={openEdit} onDelete={openDelete} /></td>
            </tr>
          ))}</tbody>
        </table>
        <div className="mobile-card-list">{categories.data.map((category) => (
          <article className="data-card category-card" key={category.id}>
            <h2>{category.name}</h2>
            <dl>
              <div><dt>Slug</dt><dd><code>{category.slug}</code></dd></div>
              <div><dt>状态</dt><dd><StatusBadge enabled={category.isEnabled} /></dd></div>
              <div><dt>排序</dt><dd>{category.sortOrder}</dd></div>
            </dl>
            <CategoryActions category={category} onEdit={openEdit} onDelete={openDelete} />
          </article>
        ))}</div>
      </>
    );
  }

  return (
    <section className="admin-page">
      <header className="page-heading category-heading">
        <div><p className="eyebrow">内容管理</p><h1>分类</h1><p className="page-heading__copy">管理滤镜分类、发布状态和默认顺序。</p></div>
        <Button onClick={openCreate}><Plus aria-hidden="true" />新增分类</Button>
      </header>
      {content}
      <CategoryFormDialog
        open={formOpen}
        category={editing}
        mutation={mutation as typeof create}
        onOpenChange={setFormOpen}
        onSuccess={() => {
          setFormOpen(false);
          notify(editing ? '分类已更新' : '分类已创建', 'success');
        }}
      />
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open && !remove.isPending) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除分类</DialogTitle>
            <DialogDescription>确定要删除“{deleting?.name}”吗？此操作无法撤销。</DialogDescription>
          </DialogHeader>
          {deleteError ? <p className="form-alert confirmation-error" role="alert">{deleteError}</p> : null}
          <DialogFooter>
            <Button variant="ghost" disabled={remove.isPending} onClick={() => setDeleting(null)}>取消</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => void deleteCategory()}>删除分类</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
