import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
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
import { ApiFailure, type FilterCreateInput } from '../../lib/admin-client';
import type { AdminCategory, AdminFilter } from '../../lib/api-schema';
import {
  NcpInspectionError,
  bytesToBase64,
  inspectNcpFile,
  type NcpInspection,
} from '../../lib/ncp-inspector';
import {
  filterClientErrors,
  mapFilterCreateError,
  ncpInspectionMessage,
  type FilterFieldErrors,
} from './filter-form';
import { NcpPreview } from './ncp-preview';

type FieldErrors = FilterFieldErrors;

interface FilterCreateDialogProps {
  open: boolean;
  categories: AdminCategory[];
  mutation: UseMutationResult<AdminFilter, Error, FilterCreateInput>;
  onOpenChange(open: boolean): void;
  onSuccess(): void;
}

export function FilterCreateDialog({
  open,
  categories,
  mutation,
  onOpenChange,
  onSuccess,
}: FilterCreateDialogProps) {
  const [inspection, setInspection] = useState<NcpInspection | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [isEnabled, setIsEnabled] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [summary, setSummary] = useState<string | null>(null);
  const inspectionGeneration = useRef(0);
  const enabledErrorId = useId();

  const clear = () => {
    inspectionGeneration.current += 1;
    setInspection(null);
    setFileError(null);
    setDisplayName('');
    setCategoryId('');
    setDescription('');
    setSlug('');
    setSortOrder('0');
    setIsEnabled(true);
    setErrors({});
    setSummary(null);
    mutation.reset();
  };

  useEffect(() => {
    if (!open) return;
    clear();
    setCategoryId(categories[0]?.id ?? '');
  // Reset strictly when opening; category arrival is handled below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && !categoryId && categories.length) setCategoryId(categories[0].id);
  }, [categories, categoryId, open]);

  const changeFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const generation = inspectionGeneration.current + 1;
    inspectionGeneration.current = generation;
    setInspection(null);
    setFileError(null);
    setErrors({});
    setSummary(null);
    if (!file) return;

    try {
      const next = await inspectNcpFile(file);
      if (inspectionGeneration.current !== generation) return;
      setInspection(next);
      setDisplayName(next.parsed.sourceName);
    } catch (error) {
      if (inspectionGeneration.current !== generation) return;
      setInspection(null);
      setFileError(error instanceof NcpInspectionError
        ? ncpInspectionMessage(error)
        : '无法读取 NCP 文件，请重试');
    }
  };

  const requestClose = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) clear();
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!inspection || mutation.isPending) return;
    const nextErrors = filterClientErrors({ displayName, categoryId, description, slug, sortOrder });
    setErrors(nextErrors);
    setSummary(null);
    if (Object.keys(nextErrors).length) return;

    const input: FilterCreateInput = {
      ncpBase64: bytesToBase64(inspection.bytes),
      displayName: displayName.trim(),
      categoryId,
      description: description.trim(),
      ...(slug.trim() ? { slug: slug.trim() } : {}),
      sortOrder: Number(sortOrder),
      isEnabled,
    };
    try {
      await mutation.mutateAsync(input);
      clear();
      onSuccess();
    } catch (error) {
      const mapped = mapFilterCreateError(error);
      setErrors(mapped.fields);
      setSummary(error instanceof ApiFailure && (error.status === 0 || error.code === 'NETWORK_ERROR')
        ? '保存失败，请重试'
        : mapped.summary);
    }
  };

  const pending = mutation.isPending;
  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="filter-create-dialog">
        <DialogHeader>
          <DialogTitle>新增滤镜</DialogTitle>
          <DialogDescription>先在本地检查 NCP，再填写发布信息；服务器会重新验证原始文件。</DialogDescription>
        </DialogHeader>
        <form className="filter-create-form" onSubmit={submit} noValidate>
          <div className="ncp-upload">
            <label htmlFor="filter-ncp-file">NCP 文件</label>
            <input
              id="filter-ncp-file"
              type="file"
              accept=".ncp,application/octet-stream"
              disabled={pending}
              onChange={(event) => void changeFile(event)}
            />
            <p>文件仅在保存时上传；支持 638 字节的 NCP 1.00。</p>
          </div>
          {fileError ? <p className="form-alert" role="alert">{fileError}</p> : null}
          {!categories.length ? (
            <div className="form-warning">
              <p>发布滤镜前，请先创建至少一个分类。</p>
              <Link to="/categories">前往分类管理</Link>
            </div>
          ) : null}
          {inspection ? (
            <>
              <NcpPreview parsed={inspection.parsed} />
              {categories.length ? <div className="filter-metadata-fields">
                {summary ? <p className="form-alert" role="alert">{summary}</p> : null}
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
                <Field label="Slug（可选）" description="留空时由服务端根据显示名称生成。" error={errors.slug}>
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
              </div> : null}
            </>
          ) : null}
          <DialogFooter>
            <Button variant="ghost" disabled={pending} onClick={() => requestClose(false)}>取消</Button>
            {inspection && categories.length ? <Button type="submit" disabled={pending}>保存滤镜</Button> : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
