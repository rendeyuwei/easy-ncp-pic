import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { ApiFailure, type FilterPatch } from '../../lib/admin-client';
import type { AdminCategory, AdminFilter } from '../../lib/api-schema';
import { parseStoredPictureControl } from '../../lib/ncp-inspector';
import { NcpPreview } from './ncp-preview';

type FieldName = 'displayName' | 'categoryId' | 'description' | 'slug' | 'sortOrder' | 'isEnabled';
type FieldErrors = Partial<Record<FieldName, string>>;

interface FilterEditDialogProps {
  open: boolean;
  filter: AdminFilter | null;
  categories: AdminCategory[];
  mutation: UseMutationResult<AdminFilter, Error, { id: string; input: FilterPatch }>;
  onOpenChange(open: boolean): void;
  onSuccess(): void;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function clientErrors(
  displayName: string,
  categoryId: string,
  description: string,
  slug: string,
  sortOrder: string,
): FieldErrors {
  const errors: FieldErrors = {};
  const cleanName = displayName.trim();
  const cleanDescription = description.trim();
  const cleanSlug = slug.trim();
  const numericOrder = Number(sortOrder);
  if (!cleanName) errors.displayName = '请输入显示名称';
  else if (Array.from(cleanName).length > 100) errors.displayName = '显示名称不能超过 100 个字符';
  if (!categoryId) errors.categoryId = '请选择分类';
  if (Array.from(cleanDescription).length > 500) errors.description = '描述不能超过 500 个字符';
  if (!cleanSlug) errors.slug = '编辑滤镜时 Slug 不能为空';
  else if (Array.from(cleanSlug).length > 60) errors.slug = 'Slug 不能超过 60 个字符';
  else if (!SLUG_PATTERN.test(cleanSlug)) errors.slug = 'Slug 只能包含小写字母、数字和单个连字符';
  if (!sortOrder.trim() || !Number.isInteger(numericOrder)) errors.sortOrder = '排序必须是整数';
  return errors;
}

function apiErrors(error: unknown): { fields: FieldErrors; summary: string | null } {
  if (!(error instanceof ApiFailure)) return { fields: {}, summary: '保存失败，请重试' };
  if (error.code === 'SLUG_CONFLICT') {
    return { fields: { slug: '该 Slug 已被使用，请选择其他 Slug' }, summary: null };
  }
  if (error.code === 'RATE_LIMITED') {
    return { fields: {}, summary: '请求过于频繁，请稍后重试' };
  }
  if (error.code !== 'VALIDATION_ERROR') {
    return { fields: {}, summary: '保存失败，请重试' };
  }

  const fields: FieldErrors = {};
  let hasUnmatched = false;
  for (const entry of error.errors ?? []) {
    if (['displayName', 'categoryId', 'description', 'slug', 'sortOrder', 'isEnabled'].includes(entry.field)) {
      fields[entry.field as FieldName] = entry.message;
    } else {
      hasUnmatched = true;
    }
  }
  return {
    fields,
    summary: hasUnmatched || !Object.keys(fields).length
      ? '输入内容有误，请检查后重试'
      : null,
  };
}

export function FilterEditDialog({
  open,
  filter,
  categories,
  mutation,
  onOpenChange,
  onSuccess,
}: FilterEditDialogProps) {
  const [displayName, setDisplayName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isEnabled, setIsEnabled] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const enabledErrorId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const parsed = useMemo(
    () => open && filter ? parseStoredPictureControl(filter.parsedJson) : null,
    [filter, open],
  );

  useEffect(() => {
    if (!open || !filter) return;
    setDisplayName(filter.displayName);
    setCategoryId(filter.categoryId);
    setDescription(filter.description);
    setSlug(filter.slug);
    setSortOrder(String(filter.sortOrder));
    setIsEnabled(filter.isEnabled);
    setErrors({});
    setSummary(null);
    mutation.reset();
  // Initialize only for a newly opened record; mutation transitions must preserve user input.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter?.id, open]);

  useEffect(() => {
    const close = contentRef.current?.querySelector<HTMLButtonElement>('.dialog__close');
    if (close) close.disabled = mutation.isPending;
  }, [mutation.isPending]);

  const requestClose = (next: boolean) => {
    if (mutation.isPending) return;
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!filter || mutation.isPending) return;
    const nextErrors = clientErrors(displayName, categoryId, description, slug, sortOrder);
    setErrors(nextErrors);
    setSummary(null);
    if (Object.keys(nextErrors).length) return;

    const input: FilterPatch = {
      displayName: displayName.trim(),
      description: description.trim(),
      categoryId,
      slug: slug.trim(),
      sortOrder: Number(sortOrder),
      isEnabled,
    };
    try {
      await mutation.mutateAsync({ id: filter.id, input });
      onSuccess();
    } catch (error) {
      const mapped = apiErrors(error);
      setErrors(mapped.fields);
      setSummary(mapped.summary);
    }
  };

  const pending = mutation.isPending;
  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent ref={contentRef} className={`filter-edit-dialog${pending ? ' filter-edit-dialog--pending' : ''}`}>
        <DialogHeader>
          <DialogTitle>编辑滤镜</DialogTitle>
          <DialogDescription>修改发布信息；已保存的 NCP 解析详情仅供查看。</DialogDescription>
        </DialogHeader>
        <form className="filter-edit-form" onSubmit={submit} noValidate>
          {parsed ? <NcpPreview parsed={parsed} /> : <p className="form-warning">解析详情不可用</p>}
          {summary ? <p className="form-alert" role="alert">{summary}</p> : null}
          <div className="filter-metadata-fields">
            <Field label="显示名称" error={errors.displayName}>
              <input value={displayName} disabled={pending} onChange={(event) => setDisplayName(event.target.value)} />
            </Field>
            <Field label="分类" error={errors.categoryId}>
              <select value={categoryId} disabled={pending} onChange={(event) => setCategoryId(event.target.value)}>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </Field>
            <Field label="描述（可选）" error={errors.description}>
              <textarea value={description} disabled={pending} onChange={(event) => setDescription(event.target.value)} />
            </Field>
            <Field label="Slug" description="修改显示名称不会自动改变 Slug。" error={errors.slug}>
              <input value={slug} disabled={pending} onChange={(event) => setSlug(event.target.value)} />
            </Field>
            <Field label="排序" error={errors.sortOrder}>
              <input type="number" step="1" value={sortOrder} disabled={pending} onChange={(event) => setSortOrder(event.target.value)} />
            </Field>
            <div className="checkbox-field-group">
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  disabled={pending}
                  aria-invalid={errors.isEnabled ? true : undefined}
                  aria-describedby={errors.isEnabled ? enabledErrorId : undefined}
                  onChange={(event) => setIsEnabled(event.target.checked)}
                />
                <span>启用滤镜</span>
              </label>
              {errors.isEnabled ? <p id={enabledErrorId} className="field__error">{errors.isEnabled}</p> : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => requestClose(false)}>取消</Button>
            <Button type="submit" disabled={pending}>保存滤镜</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
