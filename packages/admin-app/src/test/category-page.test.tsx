import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { queryKeys } from '../features/query-keys';
import { AdminApiClient } from '../lib/admin-client';
import { categoryFixture } from './fixtures';
import { renderAdminApp } from './render-app';
import { server } from './server';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  return {
    promise: new Promise<T>((next) => { resolve = next; }),
    resolve,
  };
}

function category(overrides: Partial<typeof categoryFixture> = {}) {
  return { ...categoryFixture, ...overrides };
}

function renderCategories() {
  return renderAdminApp(new AdminApiClient(), '/admin/categories');
}

beforeEach(() => {
  server.use(
    http.get('/api/admin/session', () => HttpResponse.json({ csrfToken: 'category-csrf' })),
    http.get('/api/admin/categories', () => HttpResponse.json({ categories: [categoryFixture] })),
  );
});

describe('category page states', () => {
  it('shows loading before rendering equivalent desktop and mobile category records', async () => {
    const release = deferred<void>();
    server.use(http.get('/api/admin/categories', async () => {
      await release.promise;
      return HttpResponse.json({ categories: [categoryFixture] });
    }));

    const view = renderCategories();
    expect(await screen.findByText('正在加载分类…')).toBeInTheDocument();

    release.resolve();
    const table = await screen.findByRole('table', { name: '分类列表' });
    expect(within(table).getByRole('columnheader', { name: '名称' })).toBeInTheDocument();
    expect(within(table).getByText('胶片')).toBeInTheDocument();
    expect(within(table).getByText('film')).toBeInTheDocument();
    expect(within(table).getByText('已启用')).toBeInTheDocument();
    expect(within(table).getByText('10')).toBeInTheDocument();

    const mobileList = view.container.querySelector('.mobile-card-list');
    expect(mobileList).not.toBeNull();
    expect(within(mobileList as HTMLElement).getByText('胶片')).toBeInTheDocument();
    expect(within(mobileList as HTMLElement).getByText('Slug')).toBeInTheDocument();
    expect(within(mobileList as HTMLElement).getByText('状态')).toBeInTheDocument();
    expect(within(mobileList as HTMLElement).getByText('排序')).toBeInTheDocument();
  });

  it('retries one transient failure, exposes an error action, then recovers to the empty state', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/categories', () => {
      attempts += 1;
      if (attempts <= 2) return HttpResponse.json({ code: 'INTERNAL', message: 'temporary' }, { status: 500 });
      return HttpResponse.json({ categories: [] });
    }));

    const { user } = renderCategories();
    expect(await screen.findByRole('heading', { name: '无法加载分类' })).toBeInTheDocument();
    expect(attempts).toBe(2);

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '暂无分类' })).toBeInTheDocument();
    expect(attempts).toBe(3);
  });

  it('shows an actionable empty state', async () => {
    server.use(http.get('/api/admin/categories', () => HttpResponse.json({ categories: [] })));
    renderCategories();

    expect(await screen.findByRole('heading', { name: '暂无分类' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '新增分类' }).length).toBeGreaterThan(0);
  });

  it('does not retry a malformed 4xx response', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/categories', () => {
      attempts += 1;
      return HttpResponse.text('{malformed', {
        status: 409,
        headers: { 'content-type': 'application/json' },
      });
    }));
    renderCategories();

    expect(await screen.findByRole('heading', { name: '无法加载分类' })).toBeInTheDocument();
    expect(attempts).toBe(1);
  });

  it('retries a network rejection once before showing the list error state', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/categories', () => {
      attempts += 1;
      return HttpResponse.error();
    }));
    renderCategories();

    expect(await screen.findByRole('heading', { name: '无法加载分类' })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it('retries a malformed successful response once before showing the list error state', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/categories', () => {
      attempts += 1;
      return HttpResponse.text('{malformed', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));
    renderCategories();

    expect(await screen.findByRole('heading', { name: '无法加载分类' })).toBeInTheDocument();
    expect(attempts).toBe(2);
  });
});

describe('category form mutations', () => {
  it('normalizes create input and refreshes categories while invalidating filters', async () => {
    let listRequests = 0;
    let posted: unknown;
    server.use(
      http.get('/api/admin/categories', () => {
        listRequests += 1;
        return HttpResponse.json({ categories: listRequests === 1 ? [] : [category({ name: 'Film Lab', slug: 'film-lab', sortOrder: 2 })] });
      }),
      http.post('/api/admin/categories', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ category: category({ name: 'Film Lab', slug: 'film-lab', sortOrder: 2 }) }, { status: 201 });
      }),
    );
    const { queryClient, user } = renderCategories();
    queryClient.setQueryData(queryKeys.filters, [{ id: 'cached-filter' }]);

    await screen.findByRole('heading', { name: '暂无分类' });
    await user.click(screen.getAllByRole('button', { name: '新增分类' })[0]);
    await user.type(screen.getByLabelText('名称'), '  Film Lab  ');
    await user.type(screen.getByLabelText('Slug（可选）'), '  film-lab  ');
    await user.clear(screen.getByLabelText('排序'));
    await user.type(screen.getByLabelText('排序'), '2');
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    await waitFor(() => expect(posted).toEqual({
      name: 'Film Lab',
      slug: 'film-lab',
      sortOrder: 2,
      isEnabled: true,
    }));
    expect(await screen.findByText('分类已创建')).toBeInTheDocument();
    await waitFor(() => expect(listRequests).toBe(2));
    expect(queryClient.getQueryState(queryKeys.filters)?.isInvalidated).toBe(true);
    expect(screen.queryByRole('dialog', { name: '新增分类' })).not.toBeInTheDocument();
  });

  it('mirrors server limits before sending a create request', async () => {
    let posts = 0;
    server.use(http.post('/api/admin/categories', () => {
      posts += 1;
      return HttpResponse.json({ category: category() }, { status: 201 });
    }));
    const { user } = renderCategories();

    await screen.findByRole('table', { name: '分类列表' });
    await user.click(screen.getByRole('button', { name: '新增分类' }));
    await user.type(screen.getByLabelText('名称'), 'x'.repeat(101));
    await user.type(screen.getByLabelText('Slug（可选）'), 'Invalid Slug');
    await user.clear(screen.getByLabelText('排序'));
    await user.type(screen.getByLabelText('排序'), '1.5');
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    expect(screen.getByLabelText('名称')).toHaveAccessibleDescription('名称不能超过 100 个字符');
    expect(screen.getByLabelText('Slug（可选）')).toHaveAccessibleDescription(/Slug 只能包含小写字母、数字和单个连字符/);
    expect(screen.getByLabelText('排序')).toHaveAccessibleDescription('排序必须是整数');
    expect(posts).toBe(0);
  });

  it('attaches SLUG_CONFLICT to the slug field and preserves the active form', async () => {
    server.use(http.post('/api/admin/categories', () => HttpResponse.json({
      code: 'SLUG_CONFLICT',
      message: 'internal conflict text',
    }, { status: 409 })));
    const { user } = renderCategories();

    await screen.findByRole('table', { name: '分类列表' });
    await user.click(screen.getByRole('button', { name: '新增分类' }));
    await user.type(screen.getByLabelText('名称'), '保留名称');
    await user.type(screen.getByLabelText('Slug（可选）'), 'film');
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    const slug = await screen.findByLabelText('Slug（可选）');
    expect(slug).toHaveValue('film');
    expect(slug).toHaveAttribute('aria-invalid', 'true');
    expect(slug).toHaveAccessibleDescription(/该 Slug 已被使用，请选择其他 Slug/);
    expect(screen.getByLabelText('名称')).toHaveValue('保留名称');
    expect(screen.getByRole('dialog', { name: '新增分类' }))
      .toHaveAccessibleDescription('填写分类名称、稳定 Slug、排序和启用状态。');
  });

  it('renders VALIDATION_ERROR for isEnabled beside the checkbox', async () => {
    server.use(http.post('/api/admin/categories', () => HttpResponse.json({
      code: 'VALIDATION_ERROR',
      message: 'invalid category',
      errors: [{ field: 'isEnabled', message: '必须是布尔值' }],
    }, { status: 400 })));
    const { user } = renderCategories();

    await screen.findByRole('table', { name: '分类列表' });
    await user.click(screen.getByRole('button', { name: '新增分类' }));
    await user.type(screen.getByLabelText('名称'), '测试分类');
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    const enabled = await screen.findByRole('checkbox', { name: '启用分类' });
    expect(enabled).toHaveAttribute('aria-invalid', 'true');
    expect(enabled).toHaveAccessibleDescription('必须是布尔值');
    expect(screen.getByRole('dialog', { name: '新增分类' })).toBeInTheDocument();
  });

  it('does not expose field details from unknown or INTERNAL errors', async () => {
    server.use(http.post('/api/admin/categories', () => HttpResponse.json({
      code: 'INTERNAL',
      message: 'raw internal message',
      errors: [{ field: 'slug', message: 'raw database detail' }],
    }, { status: 500 })));
    const { user } = renderCategories();

    await screen.findByRole('table', { name: '分类列表' });
    await user.click(screen.getByRole('button', { name: '新增分类' }));
    await user.type(screen.getByLabelText('名称'), '保留名称');
    await user.type(screen.getByLabelText('Slug（可选）'), 'safe-slug');
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    const dialog = screen.getByRole('dialog', { name: '新增分类' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(dialog).not.toHaveTextContent('raw internal message');
    expect(dialog).not.toHaveTextContent('raw database detail');
    expect(screen.getByLabelText('名称')).toHaveValue('保留名称');
  });

  it('maps RATE_LIMITED save errors to explicit retry-later guidance', async () => {
    server.use(http.post('/api/admin/categories', () => HttpResponse.json({
      code: 'RATE_LIMITED',
      message: 'raw throttle detail',
    }, { status: 429 })));
    const { user } = renderCategories();

    await screen.findByRole('table', { name: '分类列表' });
    await user.click(screen.getByRole('button', { name: '新增分类' }));
    await user.type(screen.getByLabelText('名称'), '限流测试');
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    const dialog = screen.getByRole('dialog', { name: '新增分类' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请求过于频繁，请稍后重试');
    expect(dialog).not.toHaveTextContent('raw throttle detail');
    expect(screen.getByLabelText('名称')).toHaveValue('限流测试');
  });

  it('accepts a name containing 60 non-BMP Unicode code points without truncation', async () => {
    const unicodeName = '😀'.repeat(60);
    let posted: unknown;
    server.use(http.post('/api/admin/categories', async ({ request }) => {
      posted = await request.json();
      return HttpResponse.json({ category: category({ name: unicodeName, slug: 'unicode' }) }, { status: 201 });
    }));
    const { user } = renderCategories();

    await screen.findByRole('table', { name: '分类列表' });
    await user.click(screen.getByRole('button', { name: '新增分类' }));
    await user.type(screen.getByLabelText('名称'), unicodeName);
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    await waitFor(() => expect(posted).toEqual({
      name: unicodeName,
      sortOrder: 0,
      isEnabled: true,
    }));
  });

  it('prefills edit values, keeps the saved slug stable, and disables submission while pending', async () => {
    const pending = deferred<Response>();
    let patched: unknown;
    server.use(http.patch('/api/admin/categories/:id', async ({ request }) => {
      patched = await request.json();
      return pending.promise;
    }));
    const { user } = renderCategories();

    const table = await screen.findByRole('table', { name: '分类列表' });
    await user.click(within(table).getByRole('button', { name: '编辑胶片' }));
    expect(screen.getByLabelText('名称')).toHaveValue('胶片');
    expect(screen.getByLabelText('Slug')).toHaveValue('film');
    expect(screen.getByLabelText('排序')).toHaveValue(10);

    await user.clear(screen.getByLabelText('名称'));
    await user.type(screen.getByLabelText('名称'), '电影');
    await user.click(screen.getByRole('button', { name: '保存分类' }));

    await waitFor(() => expect(patched).toEqual({ name: '电影', slug: 'film', sortOrder: 10, isEnabled: true }));
    expect(screen.getByRole('button', { name: '保存分类' })).toBeDisabled();
    pending.resolve(HttpResponse.json({ category: category({ name: '电影' }) }));
    expect(await screen.findByText('分类已更新')).toBeInTheDocument();
  });
});

describe('category deletion', () => {
  it('names the category, cancels without a request, then closes and refreshes after success', async () => {
    let deletes = 0;
    let listRequests = 0;
    server.use(
      http.get('/api/admin/categories', () => {
        listRequests += 1;
        return HttpResponse.json({ categories: listRequests === 1 ? [categoryFixture] : [] });
      }),
      http.delete('/api/admin/categories/:id', () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderCategories();

    const table = await screen.findByRole('table', { name: '分类列表' });
    await user.click(within(table).getByRole('button', { name: '删除胶片' }));
    let dialog = screen.getByRole('dialog', { name: '删除分类' });
    expect(within(dialog).getByText(/胶片/)).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('确定要删除“胶片”吗？此操作无法撤销。');
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(deletes).toBe(0);

    await user.click(within(table).getByRole('button', { name: '删除胶片' }));
    dialog = screen.getByRole('dialog', { name: '删除分类' });
    await user.click(within(dialog).getByRole('button', { name: '删除分类' }));

    expect(await screen.findByText('分类已删除')).toBeInTheDocument();
    await waitFor(() => expect(listRequests).toBe(2));
    expect(deletes).toBe(1);
    expect(screen.queryByRole('dialog', { name: '删除分类' })).not.toBeInTheDocument();
  });

  it('keeps the named confirmation open on CATEGORY_IN_USE and explains remediation', async () => {
    server.use(http.delete('/api/admin/categories/:id', () => HttpResponse.json({
      code: 'CATEGORY_IN_USE',
      message: 'internal database detail',
    }, { status: 409 })));
    const { user } = renderCategories();

    const table = await screen.findByRole('table', { name: '分类列表' });
    await user.click(within(table).getByRole('button', { name: '删除胶片' }));
    const dialog = screen.getByRole('dialog', { name: '删除分类' });
    await user.click(within(dialog).getByRole('button', { name: '删除分类' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请先移动或删除该分类下的滤镜');
    expect(dialog).toHaveTextContent('胶片');
    expect(dialog).toBeInTheDocument();
  });

  it('maps RATE_LIMITED delete errors to explicit retry-later guidance', async () => {
    server.use(http.delete('/api/admin/categories/:id', () => HttpResponse.json({
      code: 'RATE_LIMITED',
      message: 'raw throttle detail',
    }, { status: 429 })));
    const { user } = renderCategories();

    const table = await screen.findByRole('table', { name: '分类列表' });
    await user.click(within(table).getByRole('button', { name: '删除胶片' }));
    const dialog = screen.getByRole('dialog', { name: '删除分类' });
    await user.click(within(dialog).getByRole('button', { name: '删除分类' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请求过于频繁，请稍后重试');
    expect(dialog).not.toHaveTextContent('raw throttle detail');
    expect(dialog).toBeInTheDocument();
  });
});
