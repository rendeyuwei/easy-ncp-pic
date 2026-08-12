import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminApiClient } from '../lib/admin-client';
import { categoryFixture, filterFixture } from './fixtures';
import { renderAdminApp } from './render-app';
import { server } from './server';

const secondCategory = {
  ...categoryFixture,
  id: 'category-portrait',
  name: '人像',
  slug: 'portrait',
  sortOrder: 20,
};

function filter(overrides: Partial<typeof filterFixture> = {}) {
  return { ...filterFixture, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  return {
    promise: new Promise<T>((next) => { resolve = next; }),
    resolve,
  };
}

function renderFilters() {
  return renderAdminApp(new AdminApiClient(), '/admin/filters');
}

async function filterTable() {
  return screen.findByRole('table', { name: '滤镜列表' });
}

async function openEdit() {
  const table = await filterTable();
  await within(table).getByRole('button', { name: `编辑${filterFixture.displayName}` }).click();
  return screen.getByRole('dialog', { name: '编辑滤镜' });
}

async function openDelete() {
  const table = await filterTable();
  await within(table).getByRole('button', { name: `删除${filterFixture.displayName}` }).click();
  return screen.getByRole('dialog', { name: '删除滤镜' });
}

beforeEach(() => {
  server.use(
    http.get('/api/admin/session', () => HttpResponse.json({ csrfToken: 'manage-csrf' })),
    http.get('/api/admin/categories', () => HttpResponse.json({ categories: [categoryFixture, secondCategory] })),
    http.get('/api/admin/filters', () => HttpResponse.json({ filters: [filterFixture] })),
  );
});

describe('filter metadata editing', () => {
  it('offers equivalent desktop and mobile actions, prefills every field, previews stored details, and patches only metadata', async () => {
    let patched: Record<string, unknown> | undefined;
    let listRequests = 0;
    server.use(
      http.get('/api/admin/filters', () => {
        listRequests += 1;
        return HttpResponse.json({ filters: [filterFixture] });
      }),
      http.patch('/api/admin/filters/:id', async ({ params, request }) => {
        expect(params.id).toBe(filterFixture.id);
        patched = await request.json() as Record<string, unknown>;
        return HttpResponse.json({ filter: filter({ ...patched, updatedAt: '2026-08-13T00:00:00.000Z' }) });
      }),
    );
    const view = renderFilters();

    const table = await filterTable();
    expect(within(table).getByRole('columnheader', { name: '操作' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: `编辑${filterFixture.displayName}` })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: `删除${filterFixture.displayName}` })).toHaveLength(2);
    expect(within(view.container.querySelector('.filter-card') as HTMLElement)
      .getByRole('button', { name: `编辑${filterFixture.displayName}` })).toBeInTheDocument();

    await within(table).getByRole('button', { name: `编辑${filterFixture.displayName}` }).click();
    const dialog = screen.getByRole('dialog', { name: '编辑滤镜' });
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue(filterFixture.displayName);
    expect(within(dialog).getByLabelText('描述（可选）')).toHaveValue(filterFixture.description);
    expect(within(dialog).getByLabelText('分类')).toHaveValue(categoryFixture.id);
    expect(within(dialog).getByLabelText('Slug')).toHaveValue(filterFixture.slug);
    expect(within(dialog).getByLabelText('排序')).toHaveValue(filterFixture.sortOrder);
    expect(within(dialog).getByRole('checkbox', { name: '启用滤镜' })).toBeChecked();
    expect(within(dialog).getByRole('region', { name: 'NCP 详情' })).toHaveTextContent('Fuji Astia');
    expect(within(dialog).queryByLabelText('NCP 文件')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /选择|替换/ })).not.toBeInTheDocument();

    await view.user.clear(within(dialog).getByLabelText('显示名称'));
    await view.user.type(within(dialog).getByLabelText('显示名称'), '  编辑 Astia  ');
    await view.user.clear(within(dialog).getByLabelText('描述（可选）'));
    await view.user.type(within(dialog).getByLabelText('描述（可选）'), '  新描述  ');
    await view.user.selectOptions(within(dialog).getByLabelText('分类'), secondCategory.id);
    await view.user.clear(within(dialog).getByLabelText('Slug'));
    await view.user.type(within(dialog).getByLabelText('Slug'), '  edited-astia  ');
    await view.user.clear(within(dialog).getByLabelText('排序'));
    await view.user.type(within(dialog).getByLabelText('排序'), '25');
    await view.user.click(within(dialog).getByRole('checkbox', { name: '启用滤镜' }));
    await view.user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    await waitFor(() => expect(patched).toEqual({
      displayName: '编辑 Astia',
      description: '新描述',
      categoryId: secondCategory.id,
      slug: 'edited-astia',
      sortOrder: 25,
      isEnabled: false,
    }));
    expect(patched).not.toHaveProperty('ncpBase64');
    expect(patched).not.toHaveProperty('sourceName');
    expect(patched).not.toHaveProperty('parsedJson');
    expect(patched).not.toHaveProperty('ncpSha256');
    expect(Object.keys(patched ?? {})).toHaveLength(6);
    expect(await screen.findByText('滤镜已更新')).toBeInTheDocument();
    await waitFor(() => expect(listRequests).toBe(2));
    expect(screen.queryByRole('dialog', { name: '编辑滤镜' })).not.toBeInTheDocument();
  });

  it('treats invalid historical parsed JSON as nonfatal and still allows saving', async () => {
    let patches = 0;
    server.use(
      http.get('/api/admin/filters', () => HttpResponse.json({ filters: [filter({ parsedJson: '{invalid' })] })),
      http.patch('/api/admin/filters/:id', () => {
        patches += 1;
        return HttpResponse.json({ filter: filter({ parsedJson: '{invalid' }) });
      }),
    );
    const { user } = renderFilters();

    const dialog = await openEdit();
    expect(within(dialog).getByText('解析详情不可用')).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: 'NCP 详情' })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('NCP 文件')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '保存滤镜' })).toBeEnabled();
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));
    await waitFor(() => expect(patches).toBe(1));
  });

  it('validates create bounds with a required edit slug before sending PATCH', async () => {
    let patches = 0;
    server.use(http.patch('/api/admin/filters/:id', () => {
      patches += 1;
      return HttpResponse.json({ filter: filter() });
    }));
    const { user } = renderFilters();
    const dialog = await openEdit();

    await user.clear(within(dialog).getByLabelText('显示名称'));
    await user.type(within(dialog).getByLabelText('显示名称'), 'x'.repeat(101));
    await user.clear(within(dialog).getByLabelText('描述（可选）'));
    await user.type(within(dialog).getByLabelText('描述（可选）'), 'x'.repeat(501));
    await user.clear(within(dialog).getByLabelText('Slug'));
    await user.clear(within(dialog).getByLabelText('排序'));
    await user.type(within(dialog).getByLabelText('排序'), '1.5');
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    expect(within(dialog).getByLabelText('显示名称')).toHaveAccessibleDescription('显示名称不能超过 100 个字符');
    expect(within(dialog).getByLabelText('描述（可选）')).toHaveAccessibleDescription('描述不能超过 500 个字符');
    expect(within(dialog).getByLabelText('Slug')).toHaveAccessibleDescription(/编辑滤镜时 Slug 不能为空/);
    expect(within(dialog).getByLabelText('排序')).toHaveAccessibleDescription('排序必须是整数');
    expect(patches).toBe(0);
  });

  it('attaches safe slug conflicts to slug and preserves every edit', async () => {
    server.use(http.patch('/api/admin/filters/:id', () => HttpResponse.json({
      code: 'SLUG_CONFLICT',
      message: '<b>raw conflict</b>',
      errors: [{ field: 'slug', message: 'raw database detail' }],
    }, { status: 409 })));
    const { user } = renderFilters();
    const dialog = await openEdit();

    await user.clear(within(dialog).getByLabelText('显示名称'));
    await user.type(within(dialog).getByLabelText('显示名称'), '保留名称');
    await user.clear(within(dialog).getByLabelText('描述（可选）'));
    await user.type(within(dialog).getByLabelText('描述（可选）'), '保留描述');
    await user.selectOptions(within(dialog).getByLabelText('分类'), secondCategory.id);
    await user.clear(within(dialog).getByLabelText('Slug'));
    await user.type(within(dialog).getByLabelText('Slug'), 'keep-slug');
    await user.clear(within(dialog).getByLabelText('排序'));
    await user.type(within(dialog).getByLabelText('排序'), '7');
    await user.click(within(dialog).getByRole('checkbox', { name: '启用滤镜' }));
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    expect(await within(dialog).findByLabelText('Slug')).toHaveAccessibleDescription(/该 Slug 已被使用，请选择其他 Slug/);
    expect(dialog).not.toHaveTextContent('raw conflict');
    expect(dialog).not.toHaveTextContent('raw database detail');
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue('保留名称');
    expect(within(dialog).getByLabelText('描述（可选）')).toHaveValue('保留描述');
    expect(within(dialog).getByLabelText('分类')).toHaveValue(secondCategory.id);
    expect(within(dialog).getByLabelText('Slug')).toHaveValue('keep-slug');
    expect(within(dialog).getByLabelText('排序')).toHaveValue(7);
    expect(within(dialog).getByRole('checkbox', { name: '启用滤镜' })).not.toBeChecked();
  });

  it('keeps category validation accessible and hides unmatched server details', async () => {
    let patches = 0;
    server.use(http.patch('/api/admin/filters/:id', () => {
      patches += 1;
      if (patches === 1) {
        return HttpResponse.json({
          code: 'VALIDATION_ERROR',
          message: 'raw category summary',
          errors: [{ field: 'categoryId', message: '请选择存在的分类' }],
        }, { status: 400 });
      }
      return HttpResponse.json({
        code: 'INTERNAL',
        message: 'raw internal message',
        errors: [{ field: 'categoryId', message: 'raw database detail' }],
      }, { status: 500 });
    }));
    const { user } = renderFilters();
    const dialog = await openEdit();

    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));
    expect(await within(dialog).findByLabelText('分类')).toHaveAccessibleDescription('请选择存在的分类');
    expect(dialog).not.toHaveTextContent('raw category summary');
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(dialog).not.toHaveTextContent('raw internal message');
    expect(dialog).not.toHaveTextContent('raw database detail');
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue(filterFixture.displayName);
  });

  it('disables all relevant controls and prevents duplicate PATCH while pending', async () => {
    const pending = deferred<Response>();
    let patches = 0;
    server.use(http.patch('/api/admin/filters/:id', () => {
      patches += 1;
      return pending.promise;
    }));
    const { user } = renderFilters();
    const dialog = await openEdit();

    const save = within(dialog).getByRole('button', { name: '保存滤镜' });
    await user.click(save);
    await waitFor(() => expect(patches).toBe(1));
    expect(within(dialog).getByLabelText('显示名称')).toBeDisabled();
    expect(within(dialog).getByLabelText('描述（可选）')).toBeDisabled();
    expect(within(dialog).getByLabelText('分类')).toBeDisabled();
    expect(within(dialog).getByLabelText('Slug')).toBeDisabled();
    expect(within(dialog).getByLabelText('排序')).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: '启用滤镜' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '关闭' })).toBeDisabled());
    expect(save).toBeDisabled();
    await user.click(save);
    expect(patches).toBe(1);

    pending.resolve(HttpResponse.json({ filter: filter() }));
    expect(await screen.findByText('滤镜已更新')).toBeInTheDocument();
  });
});

describe('filter deletion', () => {
  it('names the filter, cancels without DELETE, then closes, refetches, and notifies after success', async () => {
    let deletes = 0;
    let listRequests = 0;
    server.use(
      http.get('/api/admin/filters', () => {
        listRequests += 1;
        return HttpResponse.json({ filters: listRequests === 1 ? [filterFixture] : [] });
      }),
      http.delete('/api/admin/filters/:id', ({ params }) => {
        expect(params.id).toBe(filterFixture.id);
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderFilters();

    let dialog = await openDelete();
    expect(dialog).toHaveAccessibleDescription(`确定要删除“${filterFixture.displayName}”吗？此操作无法撤销。`);
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(deletes).toBe(0);
    expect(screen.queryByRole('dialog', { name: '删除滤镜' })).not.toBeInTheDocument();

    dialog = await openDelete();
    await user.click(within(dialog).getByRole('button', { name: '删除滤镜' }));
    expect(await screen.findByText('滤镜已删除')).toBeInTheDocument();
    await waitFor(() => expect(listRequests).toBe(2));
    expect(deletes).toBe(1);
    expect(screen.queryByRole('dialog', { name: '删除滤镜' })).not.toBeInTheDocument();
  });

  it('disables destructive controls while pending and prevents duplicate DELETE', async () => {
    const pending = deferred<Response>();
    let deletes = 0;
    server.use(http.delete('/api/admin/filters/:id', () => {
      deletes += 1;
      return pending.promise;
    }));
    const { user } = renderFilters();
    const dialog = await openDelete();
    const remove = within(dialog).getByRole('button', { name: '删除滤镜' });

    await user.click(remove);
    await waitFor(() => expect(deletes).toBe(1));
    expect(remove).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '关闭' })).toBeDisabled());
    await user.click(remove);
    expect(deletes).toBe(1);

    pending.resolve(new HttpResponse(null, { status: 204 }));
    expect(await screen.findByText('滤镜已删除')).toBeInTheDocument();
  });

  it('keeps named context after a safe failure and allows retry', async () => {
    let deletes = 0;
    server.use(http.delete('/api/admin/filters/:id', () => {
      deletes += 1;
      if (deletes === 1) {
        return HttpResponse.json({
          code: 'INTERNAL',
          message: '<b>raw delete detail</b>',
        }, { status: 500 });
      }
      return new HttpResponse(null, { status: 204 });
    }));
    const { user } = renderFilters();
    const dialog = await openDelete();
    const remove = within(dialog).getByRole('button', { name: '删除滤镜' });

    await user.click(remove);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('删除失败，请重试');
    expect(dialog).not.toHaveTextContent('raw delete detail');
    expect(dialog).toHaveTextContent(filterFixture.displayName);
    expect(dialog).toBeInTheDocument();
    expect(remove).toBeEnabled();
    await user.click(remove);
    expect(await screen.findByText('滤镜已删除')).toBeInTheDocument();
    expect(deletes).toBe(2);
  });
});
