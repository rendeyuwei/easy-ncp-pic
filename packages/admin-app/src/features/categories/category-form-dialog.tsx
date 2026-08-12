import { useEffect, useState, type FormEvent } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { Field } from '../../components/ui/field';
import { ApiFailure, type CategoryInput } from '../../lib/admin-client';
import type { AdminCategory } from '../../lib/api-schema';

type FieldName = 'name' | 'slug' | 'sortOrder' | 'isEnabled';
type FieldErrors = Partial<Record<FieldName, string>>;

interface CategoryFormDialogProps {
  open: boolean;
  category: AdminCategory | null;
  mutation: UseMutationResult<AdminCategory, Error, CategoryInput>
    | UseMutationResult<AdminCategory, Error, { id: string; input: CategoryInput }>;
  onOpenChange(open: boolean): void;
  onSuccess(): void;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clientErrors(name: string, slug: string, sortOrder: string, editing: boolean): FieldErrors {
  const errors: FieldErrors = {};
  const cleanName = name.trim();
  const cleanSlug = slug.trim();
  const numericOrder = Number(sortOrder);
  if (!cleanName) errors.name = '请输入名称';
  else if (cleanName.length > 100) errors.name = '名称不能超过 100 个字符';
  if (editing && !cleanSlug) errors.slug = '编辑分类时 Slug 不能为空';
  else if (cleanSlug.length > 60) errors.slug = 'Slug 不能超过 60 个字符';
  else if (cleanSlug && !SLUG_PATTERN.test(cleanSlug)) errors.slug = 'Slug 只能包含小写字母、数字和单个连字符';
  if (!sortOrder.trim() || !Number.isInteger(numericOrder)) errors.sortOrder = '排序必须是整数';
  return errors;
}

function apiErrors(error: unknown): { fields: FieldErrors; summary: string | null } {
  if (!(error instanceof ApiFailure)) return { fields: {}, summary: '保存失败，请重试' };
  const fields: FieldErrors = {};
  const unmatched: string[] = [];
  for (const entry of error.errors ?? []) {
    if (['name', 'slug', 'sortOrder', 'isEnabled'].includes(entry.field)) {
      fields[entry.field as FieldName] = entry.message;
    } else {
      unmatched.push(entry.message);
    }
  }
  if (error.code === 'SLUG_CONFLICT') fields.slug = '该 Slug 已被使用，请选择其他 Slug';
  return { fields, summary: unmatched.length ? unmatched.join('；') : Object.keys(fields).length ? null : '保存失败，请重试' };
}

export function CategoryFormDialog({
  open,
  category,
  mutation,
  onOpenChange,
  onSuccess,
}: CategoryFormDialogProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isEnabled, setIsEnabled] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const editing = category !== null;

  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? '');
    setSlug(category?.slug ?? '');
    setSortOrder(String(category?.sortOrder ?? 0));
    setIsEnabled(category?.isEnabled ?? true);
    setErrors({});
    setSummary(null);
    mutation.reset();
  // Reset strictly on dialog identity/open transitions, not on mutation state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category?.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = clientErrors(name, slug, sortOrder, editing);
    setErrors(nextErrors);
    setSummary(null);
    if (Object.keys(nextErrors).length) return;

    const input: CategoryInput = {
      name: name.trim(),
      sortOrder: Number(sortOrder),
      isEnabled,
      ...(slug.trim() ? { slug: slug.trim() } : {}),
    };
    try {
      if (category) {
        await (mutation as UseMutationResult<AdminCategory, Error, { id: string; input: CategoryInput }>).mutateAsync({ id: category.id, input });
      } else {
        await (mutation as UseMutationResult<AdminCategory, Error, CategoryInput>).mutateAsync(input);
      }
      onSuccess();
    } catch (error) {
      const mapped = apiErrors(error);
      setErrors(mapped.fields);
      setSummary(mapped.summary);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!mutation.isPending) onOpenChange(next); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{editing ? '编辑分类' : '新增分类'}</DialogTitle>
          <DialogDescription>填写分类名称、稳定 Slug、排序和启用状态。</DialogDescription>
        </DialogHeader>
        <form className="category-form" onSubmit={submit} noValidate>
          {summary ? <p className="form-alert" role="alert">{summary}</p> : null}
          <Field label="名称" error={errors.name}>
            <input value={name} maxLength={101} onChange={(event) => setName(event.target.value)} autoFocus />
          </Field>
          <Field label={editing ? 'Slug' : 'Slug（可选）'} description={editing ? '修改名称不会自动改变 Slug。' : '留空时由服务端根据名称生成。'} error={errors.slug}>
            <input value={slug} maxLength={61} onChange={(event) => setSlug(event.target.value)} />
          </Field>
          <Field label="排序" error={errors.sortOrder}>
            <input type="number" step="1" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} />
          </Field>
          <label className="checkbox-field">
            <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />
            <span>启用分类</span>
          </label>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>取消</Button>
            <Button type="submit" disabled={mutation.isPending}>保存分类</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
