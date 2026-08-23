import { ApiFailure } from '../../lib/admin-client';
import { NcpInspectionError } from '../../lib/ncp-inspector';

export type FilterFieldName =
  | 'displayName'
  | 'categoryId'
  | 'description'
  | 'slug'
  | 'sortOrder'
  | 'isEnabled';

export type FilterFieldErrors = Partial<Record<FilterFieldName, string>>;

export interface FilterFormValues {
  displayName: string;
  categoryId: string;
  description: string;
  slug: string;
  sortOrder: string;
}

export interface FilterCreateErrorMapping {
  fields: FilterFieldErrors;
  summary: string | null;
  retryable: boolean;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function filterClientErrors(values: FilterFormValues): FilterFieldErrors {
  const errors: FilterFieldErrors = {};
  const cleanName = values.displayName.trim();
  const cleanDescription = values.description.trim();
  const cleanSlug = values.slug.trim();
  const numericOrder = Number(values.sortOrder);
  if (!cleanName) errors.displayName = '请输入显示名称';
  else if (Array.from(cleanName).length > 100) errors.displayName = '显示名称不能超过 100 个字符';
  if (!values.categoryId) errors.categoryId = '请选择分类';
  if (Array.from(cleanDescription).length > 500) errors.description = '描述不能超过 500 个字符';
  if (Array.from(cleanSlug).length > 60) errors.slug = 'Slug 不能超过 60 个字符';
  else if (cleanSlug && !SLUG_PATTERN.test(cleanSlug)) errors.slug = 'Slug 只能包含小写字母、数字和单个连字符';
  if (!values.sortOrder.trim() || !Number.isInteger(numericOrder)) errors.sortOrder = '排序必须是整数';
  return errors;
}

export function mapFilterCreateError(error: unknown): FilterCreateErrorMapping {
  if (!(error instanceof ApiFailure)) {
    return { fields: {}, summary: '保存失败，请重试', retryable: true };
  }

  if (error.status === 0 || error.code === 'NETWORK_ERROR') {
    return { fields: {}, summary: '网络连接中断，导入已暂停', retryable: true };
  }
  if (error.code === 'DUPLICATE_NCP') {
    return { fields: {}, summary: '该 NCP 已经发布，请选择其他文件', retryable: false };
  }
  if (error.code === 'SLUG_CONFLICT') {
    return { fields: { slug: '该 Slug 已被使用，请选择其他 Slug' }, summary: null, retryable: false };
  }
  if (error.code === 'PAYLOAD_TOO_LARGE') {
    return { fields: {}, summary: '完整上传请求超过 64 KiB；当前支持的 NCP 文件应为 638 字节', retryable: false };
  }
  if (error.code === 'INVALID_NCP') {
    return { fields: {}, summary: '服务器判定该文件不是有效的受支持 NCP', retryable: false };
  }
  if (error.code === 'UNSUPPORTED_NCP') {
    return { fields: {}, summary: '服务器判定当前不支持发布此 NCP', retryable: false };
  }
  if (error.code === 'RATE_LIMITED') {
    return { fields: {}, summary: '请求过于频繁，请稍后重试', retryable: true };
  }
  if (error.code !== 'VALIDATION_ERROR') {
    return {
      fields: {},
      summary: '保存失败，请重试',
      retryable: error.status >= 500,
    };
  }

  const fields: FilterFieldErrors = {};
  let hasUnmatched = false;
  for (const entry of error.errors ?? []) {
    if (['displayName', 'categoryId', 'description', 'slug', 'sortOrder', 'isEnabled'].includes(entry.field)) {
      fields[entry.field as FilterFieldName] = entry.message;
    } else {
      hasUnmatched = true;
    }
  }
  return {
    fields,
    summary: hasUnmatched
      ? '输入内容有误，请检查后重试'
      : Object.keys(fields).length ? null : '输入内容有误，请检查后重试',
    retryable: false,
  };
}

export function ncpInspectionMessage(error: NcpInspectionError): string {
  switch (error.code) {
    case 'EMPTY_FILE': return '请选择一个非空的 NCP 文件';
    case 'FILE_TOO_LARGE': return 'NCP 文件不能超过 64 KiB';
    case 'UNSUPPORTED_NCP': return '当前不支持发布此 NCP';
    case 'INVALID_NCP': return 'NCP 文件已损坏或格式无效';
  }
}
