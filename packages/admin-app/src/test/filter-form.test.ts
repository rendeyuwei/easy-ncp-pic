import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../lib/admin-client';
import { NcpInspectionError } from '../lib/ncp-inspector';
import {
  filterClientErrors,
  mapFilterCreateError,
  ncpInspectionMessage,
} from '../features/filters/filter-form';

describe('filter form rules', () => {
  it('keeps the single-create client validation bounds and copy', () => {
    expect(filterClientErrors({
      displayName: ' ',
      categoryId: '',
      description: '',
      slug: '',
      sortOrder: 'x',
    })).toEqual({
      displayName: '请输入显示名称',
      categoryId: '请选择分类',
      sortOrder: '排序必须是整数',
    });

    expect(filterClientErrors({
      displayName: '😀'.repeat(100),
      categoryId: 'film',
      description: '😀'.repeat(500),
      slug: 'a'.repeat(60),
      sortOrder: '0',
    })).toEqual({});
    expect(filterClientErrors({
      displayName: '😀'.repeat(101),
      categoryId: 'film',
      description: '😀'.repeat(501),
      slug: 'a'.repeat(61),
      sortOrder: '0',
    })).toEqual({
      displayName: '显示名称不能超过 100 个字符',
      description: '描述不能超过 500 个字符',
      slug: 'Slug 不能超过 60 个字符',
    });
  });

  it('maps duplicate NCP errors without allowing an unchanged retry', () => {
    expect(mapFilterCreateError(
      new ApiFailure(409, 'DUPLICATE_NCP', 'duplicate'),
    )).toMatchObject({
      fields: {},
      summary: '该 NCP 已经发布，请选择其他文件',
      retryable: false,
    });
  });

  it('maps network failures to a retryable paused-import summary', () => {
    expect(mapFilterCreateError(
      new ApiFailure(0, 'NETWORK_ERROR', 'offline'),
    )).toMatchObject({
      fields: {},
      summary: '网络连接中断，导入已暂停',
      retryable: true,
    });
  });

  it('keeps field and inspection error mappings safe and user-facing', () => {
    expect(mapFilterCreateError(new ApiFailure(409, 'SLUG_CONFLICT', 'raw'))).toEqual({
      fields: { slug: '该 Slug 已被使用，请选择其他 Slug' },
      summary: null,
      retryable: false,
    });
    expect(mapFilterCreateError(new ApiFailure(400, 'VALIDATION_ERROR', 'raw', [
      { field: 'displayName', message: 'server name' },
      { field: 'database', message: 'unsafe detail' },
    ]))).toEqual({
      fields: { displayName: 'server name' },
      summary: '输入内容有误，请检查后重试',
      retryable: false,
    });
    expect(mapFilterCreateError(new Error('offline'))).toEqual({
      fields: {},
      summary: '保存失败，请重试',
      retryable: true,
    });

    expect(ncpInspectionMessage(new NcpInspectionError('EMPTY_FILE', 'raw'))).toBe('请选择一个非空的 NCP 文件');
    expect(ncpInspectionMessage(new NcpInspectionError('FILE_TOO_LARGE', 'raw'))).toBe('NCP 文件不能超过 64 KiB');
    expect(ncpInspectionMessage(new NcpInspectionError('UNSUPPORTED_NCP', 'raw'))).toBe('当前不支持发布此 NCP');
    expect(ncpInspectionMessage(new NcpInspectionError('INVALID_NCP', 'raw'))).toBe('NCP 文件已损坏或格式无效');
  });
});
