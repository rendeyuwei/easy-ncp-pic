import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { AdminApiClient } from '../lib/admin-client';
import { MAX_NCP_FILE_BYTES } from '../lib/ncp-inspector';
import { categoryFixture, filterFixture } from './fixtures';
import { renderAdminApp } from './render-app';
import { server } from './server';

const here = dirname(fileURLToPath(import.meta.url));
const fixture02 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON02.NCP')),
);
const fixture33 = new Uint8Array(
  readFileSync(join(here, '../../../ncp-parser/test/fixtures/PICCON33.NCP')),
);

function ncpFile(bytes = fixture02, name = 'PICCON02.NCP'): File {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes.slice().buffer,
  });
  return file;
}

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

function bulkRowLabel(fileName: string, field: string) {
  return `${fileName} ${field}（桌面）`;
}

async function openCreate() {
  const buttons = await screen.findAllByRole('button', { name: '新增滤镜' });
  await waitFor(() => expect(buttons[0]).toBeEnabled());
  await buttons[0].click();
  return screen.getByRole('dialog', { name: '新增滤镜' });
}

beforeEach(() => {
  server.use(
    http.get('/api/admin/session', () => HttpResponse.json({ csrfToken: 'filter-csrf' })),
    http.get('/api/admin/categories', () => HttpResponse.json({ categories: [categoryFixture] })),
    http.get('/api/admin/filters', () => HttpResponse.json({ filters: [] })),
  );
});

describe('filter page states', () => {
  it('shows loading then preserves API order in equivalent desktop and mobile rows', async () => {
    const release = deferred<void>();
    const first = filter({
      id: 'filter-first',
      displayName: '柔和 Astia',
      sourceName: 'Fuji Astia',
      updatedAt: '2026-08-12T10:30:00+08:00',
    });
    const missingCategory = filter({
      id: 'filter-second',
      displayName: '无归属滤镜',
      sourceName: 'Unknown Source',
      categoryId: 'missing-category',
      sortOrder: 30,
      isEnabled: false,
      updatedAt: '2026-08-12T11:00:00+08:00',
    });
    server.use(http.get('/api/admin/filters', async ({ request }) => {
      expect(request.signal).toBeInstanceOf(AbortSignal);
      await release.promise;
      return HttpResponse.json({ filters: [first, missingCategory] });
    }));

    const view = renderFilters();
    expect(await screen.findByText('正在加载滤镜…')).toBeInTheDocument();

    release.resolve();
    const table = await screen.findByRole('table', { name: '滤镜列表' });
    expect(within(table).getByRole('columnheader', { name: '滤镜' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: '分类' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: '状态' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: '排序' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: '更新时间' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('柔和 Astia');
    expect(rows[0]).toHaveTextContent('Fuji Astia');
    expect(rows[0]).toHaveTextContent('胶片');
    expect(rows[0]).toHaveTextContent('已启用');
    expect(rows[0]).toHaveTextContent('20');
    expect(rows[0]).toHaveTextContent('2026年8月12日 10:30');
    expect(rows[1]).toHaveTextContent('未知分类');
    expect(rows[1]).toHaveTextContent('已停用');

    const cards = view.container.querySelectorAll('.filter-card');
    expect(cards).toHaveLength(2);
    expect(cards[0].parentElement).toHaveClass('filter-card-list--stacked');
    expect(cards[0]).toHaveTextContent('柔和 Astia');
    expect(cards[0]).toHaveTextContent('Fuji Astia');
    expect(cards[0]).toHaveTextContent('胶片');
    expect(cards[1]).toHaveTextContent('未知分类');
  });

  it('retries one transient failure, shows an error action, then recovers to empty', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/filters', () => {
      attempts += 1;
      if (attempts <= 2) {
        return HttpResponse.json({ code: 'INTERNAL', message: 'temporary' }, { status: 500 });
      }
      return HttpResponse.json({ filters: [] });
    }));

    const { user } = renderFilters();
    expect(await screen.findByRole('heading', { name: '无法加载滤镜' })).toBeInTheDocument();
    expect(attempts).toBe(2);
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '暂无滤镜' })).toBeInTheDocument();
    expect(attempts).toBe(3);
  });

  it('does not retry a 4xx list failure', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/filters', () => {
      attempts += 1;
      return HttpResponse.json({ code: 'FORBIDDEN', message: 'forbidden' }, { status: 403 });
    }));

    renderFilters();
    expect(await screen.findByRole('heading', { name: '无法加载滤镜' })).toBeInTheDocument();
    expect(attempts).toBe(1);
  });
});

describe('local-first filter creation', () => {
  it('keeps creation unavailable and accurately described while categories are pending', async () => {
    const release = deferred<void>();
    server.use(http.get('/api/admin/categories', async () => {
      await release.promise;
      return HttpResponse.json({ categories: [categoryFixture] });
    }));
    renderFilters();

    const create = await screen.findByRole('button', { name: '新增滤镜' });
    const bulk = screen.getByRole('button', { name: '批量导入' });
    for (const action of [bulk, create]) {
      expect(action).toBeDisabled();
      expect(action).toHaveAccessibleDescription('正在加载分类，分类相关操作暂不可用。');
    }
    expect(screen.queryByText('发布滤镜前，请先创建至少一个分类。')).not.toBeInTheDocument();

    release.resolve();
    await waitFor(() => {
      expect(bulk).toBeEnabled();
      expect(create).toBeEnabled();
    });
    expect(bulk).not.toHaveAccessibleDescription();
    expect(create).not.toHaveAccessibleDescription();
  });

  it('reports category failure without claiming an empty result and enables creation after retry', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/categories', () => {
      attempts += 1;
      if (attempts <= 2) {
        return HttpResponse.json({ code: 'INTERNAL', message: 'temporary' }, { status: 500 });
      }
      return HttpResponse.json({ categories: [categoryFixture] });
    }));
    const { user } = renderFilters();

    expect(await screen.findByRole('heading', { name: '无法加载滤镜' })).toBeInTheDocument();
    expect(attempts).toBe(2);
    const create = screen.getByRole('button', { name: '新增滤镜' });
    const bulk = screen.getByRole('button', { name: '批量导入' });
    for (const action of [bulk, create]) {
      expect(action).toBeDisabled();
      expect(action).toHaveAccessibleDescription('分类加载失败，请重试后再进行分类相关操作。');
    }
    expect(screen.queryByText('发布滤镜前，请先创建至少一个分类。')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '暂无滤镜' })).toBeInTheDocument();
    expect(attempts).toBe(3);
    expect(bulk).toBeEnabled();
    expect(create).toBeEnabled();
    await user.click(create);
    const dialog = screen.getByRole('dialog', { name: '新增滤镜' });
    expect(within(dialog).queryByRole('link', { name: '前往分类管理' })).not.toBeInTheDocument();
  });

  it('opens bulk import with category parity but waits for an authoritative filter list before inspection', async () => {
    const releaseFilters = deferred<void>();
    server.use(http.get('/api/admin/filters', async () => {
      await releaseFilters.promise;
      return HttpResponse.json({ filters: [filter({ sortOrder: 41 })] });
    }));
    const { user } = renderFilters();

    const bulk = await screen.findByRole('button', { name: '批量导入' });
    const create = screen.getByRole('button', { name: '新增滤镜' });
    await waitFor(() => {
      expect(bulk).toBeEnabled();
      expect(create).toBeEnabled();
    });
    await user.click(bulk);
    const dialog = screen.getByRole('dialog', { name: '批量导入滤镜' });
    const picker = within(dialog).getByLabelText('NCP 文件（可多选）');
    expect(picker).toBeDisabled();
    expect(picker).toHaveAccessibleDescription(
      '现有滤镜尚未加载完成，暂时无法选择文件或计算排序。',
    );
    expect(within(dialog).queryByLabelText(bulkRowLabel('PICCON02.NCP', '排序'))).not.toBeInTheDocument();

    releaseFilters.resolve();
    await waitFor(() => expect(picker).toBeEnabled());
    expect(picker).not.toHaveAccessibleDescription();
    await user.upload(picker, ncpFile());

    expect(await within(dialog).findByLabelText(bulkRowLabel('PICCON02.NCP', '排序'))).toHaveValue(42);
  });

  it('keeps bulk file selection guarded after a filter-list error and recovers after retry', async () => {
    let attempts = 0;
    server.use(http.get('/api/admin/filters', () => {
      attempts += 1;
      if (attempts <= 2) {
        return HttpResponse.json({ code: 'INTERNAL', message: 'temporary' }, { status: 500 });
      }
      return HttpResponse.json({ filters: [] });
    }));
    const { user } = renderFilters();

    const bulk = await screen.findByRole('button', { name: '批量导入' });
    await waitFor(() => expect(bulk).toBeEnabled());
    await user.click(bulk);
    let dialog = screen.getByRole('dialog', { name: '批量导入滤镜' });
    expect(within(dialog).getByLabelText('NCP 文件（可多选）')).toBeDisabled();
    expect(within(dialog).getByLabelText('NCP 文件（可多选）')).toHaveAccessibleDescription(
      '现有滤镜尚未加载完成，暂时无法选择文件或计算排序。',
    );

    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '暂无滤镜' })).toBeInTheDocument();
    expect(attempts).toBe(3);
    await user.click(screen.getByRole('button', { name: '批量导入' }));
    dialog = screen.getByRole('dialog', { name: '批量导入滤镜' });
    expect(within(dialog).getByLabelText('NCP 文件（可多选）')).toBeEnabled();
  });

  it('bulk imports current rows sequentially, reports partial success, and refreshes the list once', async () => {
    const monochromeCategory = {
      ...categoryFixture,
      id: 'category-monochrome',
      name: '黑白',
      slug: 'monochrome',
      sortOrder: 20,
    };
    const existing = filter({ sortOrder: 41 });
    let listRequests = 0;
    let posts = 0;
    server.use(
      http.get('/api/admin/categories', () => HttpResponse.json({
        categories: [categoryFixture, monochromeCategory],
      })),
      http.get('/api/admin/filters', () => {
        listRequests += 1;
        return HttpResponse.json({ filters: listRequests === 1 ? [existing] : [
          existing,
          filter({ id: 'filter-bulk-created', displayName: 'Fuji Astia Bulk', sortOrder: 42 }),
        ] });
      }),
      http.post('/api/admin/filters', async ({ request }) => {
        posts += 1;
        const body = await request.json() as Record<string, unknown>;
        if (posts === 1) {
          expect(body).toMatchObject({
            displayName: 'Fuji Astia',
            categoryId: categoryFixture.id,
            sortOrder: 42,
          });
          return HttpResponse.json({
            filter: filter({ id: 'filter-bulk-created', displayName: 'Fuji Astia', sortOrder: 42 }),
          }, { status: 201 });
        }
        expect(body).toMatchObject({
          displayName: 'SHING TokugawaTone2',
          categoryId: monochromeCategory.id,
          sortOrder: 43,
        });
        return HttpResponse.json({
          code: 'DUPLICATE_NCP',
          message: 'already exists',
        }, { status: 409 });
      }),
    );
    const { user } = renderFilters();

    await user.click(await screen.findByRole('button', { name: '批量导入' }));
    const dialog = screen.getByRole('dialog', { name: '批量导入滤镜' });
    await user.upload(within(dialog).getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'PICCON02.NCP'),
      ncpFile(fixture33, 'PICCON33.NCP'),
    ]);

    const firstOrder = await within(dialog).findByLabelText(bulkRowLabel('PICCON02.NCP', '排序'));
    const secondOrder = within(dialog).getByLabelText(bulkRowLabel('PICCON33.NCP', '排序'));
    const secondCategory = within(dialog).getByLabelText(bulkRowLabel('PICCON33.NCP', '分类'));
    expect(firstOrder).toHaveValue(42);
    expect(secondOrder).toHaveValue(43);
    expect(secondCategory).toHaveDisplayValue('胶片');
    expect(within(secondCategory).getByRole('option', { name: '黑白' })).toHaveValue(monochromeCategory.id);
    await user.selectOptions(secondCategory, monochromeCategory.id);

    await user.click(within(dialog).getByRole('button', { name: '导入可用项' }));

    await waitFor(() => {
      const notificationCopies = screen.getAllByText('已导入 1 个滤镜，1 个需要处理')
        .filter((message) => !dialog.contains(message));
      expect(notificationCopies).toHaveLength(1);
      expect(notificationCopies[0]?.parentElement).toHaveClass('notification--success');
    });
    expect(within(dialog).getByText('已导入 1 个滤镜，1 个需要处理')).toBeInTheDocument();
    expect(within(dialog).getAllByText('已存在').length).toBeGreaterThan(0);
    expect(dialog).toBeInTheDocument();
    expect(posts).toBe(2);
    await waitFor(() => expect(listRequests).toBe(2));
  });

  it('reports an all-failed bulk run with a failure tone', async () => {
    server.use(http.post('/api/admin/filters', () => HttpResponse.json({
      code: 'DUPLICATE_NCP',
      message: 'already exists',
    }, { status: 409 })));
    const { user } = renderFilters();

    await user.click(await screen.findByRole('button', { name: '批量导入' }));
    const dialog = screen.getByRole('dialog', { name: '批量导入滤镜' });
    await user.upload(
      within(dialog).getByLabelText('NCP 文件（可多选）'),
      ncpFile(fixture02, 'all-failed.NCP'),
    );
    await within(dialog).findByLabelText(bulkRowLabel('all-failed.NCP', '显示名称'));
    await user.click(within(dialog).getByRole('button', { name: '导入可用项' }));

    await waitFor(() => {
      const notification = document.querySelector('.notification');
      expect(notification).toHaveTextContent('已导入 0 个滤镜，1 个需要处理');
      expect(notification).toHaveClass('notification--failure');
      expect(notification).not.toHaveClass('notification--success');
      expect(notification).toHaveAttribute('role', 'alert');
    });
  });

  it('reports a paused bulk run without treating untouched rows as completed failures', async () => {
    let posts = 0;
    server.use(
      http.get('/api/admin/filters', () => HttpResponse.json({ filters: [] })),
      http.post('/api/admin/filters', () => {
        posts += 1;
        if (posts === 1) {
          return HttpResponse.json({
            filter: filter({ id: 'filter-before-pause', displayName: 'Fuji Astia' }),
          }, { status: 201 });
        }
        return HttpResponse.error();
      }),
    );
    const { user } = renderFilters();

    await user.click(await screen.findByRole('button', { name: '批量导入' }));
    const dialog = screen.getByRole('dialog', { name: '批量导入滤镜' });
    await user.upload(within(dialog).getByLabelText('NCP 文件（可多选）'), [
      ncpFile(fixture02, 'PICCON02.NCP'),
      ncpFile(fixture33, 'PICCON33.NCP'),
    ]);
    await within(dialog).findByLabelText(bulkRowLabel('PICCON33.NCP', '显示名称'));

    await user.click(within(dialog).getByRole('button', { name: '导入可用项' }));

    await waitFor(() => {
      const notificationCopies = screen
        .queryAllByText('导入已暂停，已导入 1 个滤镜，请检查未完成项')
        .filter((message) => !dialog.contains(message));
      expect(notificationCopies).toHaveLength(1);
      expect(notificationCopies[0]?.parentElement).toHaveClass('notification--info');
    });
    expect(within(dialog).getByText('导入已暂停，已完成 2 / 2')).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(posts).toBe(2);
  });

  it('keeps both create actions ready and explains their prerequisites when no category exists', async () => {
    server.use(http.get('/api/admin/categories', () => HttpResponse.json({ categories: [] })));
    const { user } = renderFilters();

    const bulk = await screen.findByRole('button', { name: '批量导入' });
    const create = screen.getByRole('button', { name: '新增滤镜' });
    await waitFor(() => {
      expect(bulk).toBeEnabled();
      expect(create).toBeEnabled();
    });
    await user.click(bulk);
    const bulkDialog = screen.getByRole('dialog', { name: '批量导入滤镜' });
    expect(within(bulkDialog).getByText('导入滤镜前，请先创建至少一个分类。')).toBeInTheDocument();
    expect(within(bulkDialog).getByLabelText('默认分类')).toBeDisabled();
    await user.click(within(bulkDialog).getByRole('button', { name: '取消' }));

    const dialog = await openCreate();
    const link = within(dialog).getByRole('link', { name: '前往分类管理' });
    expect(link).toHaveAttribute('href', '/admin/categories');
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    expect(await within(dialog).findByText('Fuji Astia')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('分类')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '保存滤镜' })).not.toBeInTheDocument();
  });

  it('publishes the genuine 638-byte file without sending trusted parsed output', async () => {
    let listRequests = 0;
    let posted: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/admin/filters', () => {
        listRequests += 1;
        return HttpResponse.json({ filters: listRequests === 1 ? [] : [filter()] });
      }),
      http.post('/api/admin/filters', async ({ request }) => {
        posted = await request.json() as Record<string, unknown>;
        const decoded = Uint8Array.from(atob(posted.ncpBase64 as string), (character) => character.charCodeAt(0));
        expect(decoded).toHaveLength(638);
        expect(decoded).toEqual(fixture02);
        expect(posted).not.toHaveProperty('parsed');
        expect(posted).not.toHaveProperty('parsedJson');
        return HttpResponse.json({ filter: filter() }, { status: 201 });
      }),
    );
    const { user } = renderFilters();

    const dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    expect(await within(dialog).findByText('Fuji Astia')).toBeInTheDocument();
    expect(within(dialog).getByText('Neutral')).toBeInTheDocument();
    expect(within(dialog).getByText('来源版本').nextElementSibling).toHaveTextContent('1');
    expect(within(dialog).getByText('Schema 版本').nextElementSibling).toHaveTextContent('1');
    expect(within(dialog).getByText('控制点').nextElementSibling).toHaveTextContent('6');
    expect(within(dialog).getByText('LUT 条目').nextElementSibling).toHaveTextContent('257');
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue('Fuji Astia');

    await user.clear(within(dialog).getByLabelText('显示名称'));
    await user.type(within(dialog).getByLabelText('显示名称'), '  发布 Astia  ');
    await user.selectOptions(within(dialog).getByLabelText('分类'), categoryFixture.id);
    await user.type(within(dialog).getByLabelText('描述（可选）'), '  柔和的胶片风格  ');
    await user.type(within(dialog).getByLabelText('Slug（可选）'), '  publish-astia  ');
    await user.clear(within(dialog).getByLabelText('排序'));
    await user.type(within(dialog).getByLabelText('排序'), '12');
    await user.click(within(dialog).getByRole('checkbox', { name: '启用滤镜' }));
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    await waitFor(() => expect(posted).toEqual({
      ncpBase64: expect.any(String),
      displayName: '发布 Astia',
      categoryId: categoryFixture.id,
      description: '柔和的胶片风格',
      slug: 'publish-astia',
      sortOrder: 12,
      isEnabled: false,
    }));
    expect(await screen.findByText('滤镜已创建')).toBeInTheDocument();
    await waitFor(() => expect(listRequests).toBe(2));
    expect(screen.queryByRole('dialog', { name: '新增滤镜' })).not.toBeInTheDocument();
  });

  it.each([
    ['损坏', () => {
      const bytes = fixture02.slice();
      bytes[0] = 0;
      return ncpFile(bytes, 'damaged.NCP');
    }, 'NCP 文件已损坏或格式无效'],
    ['不支持', () => {
      const bytes = fixture02.slice();
      bytes[0x24] = 0xff;
      return ncpFile(bytes, 'unsupported.NCP');
    }, '当前不支持发布此 NCP'],
    ['超限', () => ncpFile(new Uint8Array(MAX_NCP_FILE_BYTES + 1), 'large.NCP'), 'NCP 文件不能超过 64 KiB'],
  ])('rejects %s files locally without POST', async (_kind, makeFile, expected) => {
    let posts = 0;
    server.use(http.post('/api/admin/filters', () => {
      posts += 1;
      return HttpResponse.json({ filter: filter() }, { status: 201 });
    }));
    const { user } = renderFilters();

    const dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), makeFile());
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(expected);
    expect(within(dialog).queryByRole('button', { name: '保存滤镜' })).not.toBeInTheDocument();
    expect(posts).toBe(0);
  });

  it('atomically replaces errors, preview, and the default name only on file replacement', async () => {
    const damaged = fixture02.slice();
    damaged[0] = 0;
    const { user } = renderFilters();
    const dialog = await openCreate();
    const picker = within(dialog).getByLabelText('NCP 文件');

    await user.upload(picker, ncpFile(damaged, 'damaged.NCP'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('NCP 文件已损坏或格式无效');
    await user.upload(picker, ncpFile());
    expect(await within(dialog).findByText('Fuji Astia')).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    const displayName = within(dialog).getByLabelText('显示名称');
    await user.clear(displayName);
    await user.type(displayName, '管理员命名');
    expect(displayName).toHaveValue('管理员命名');

    await user.upload(picker, ncpFile(fixture33, 'PICCON33.NCP'));
    expect(await within(dialog).findByText('SHING TokugawaTone2')).toBeInTheDocument();
    expect(within(dialog).getByText('Monochrome')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue('SHING TokugawaTone2');
    expect(within(dialog).queryByText('Fuji Astia')).not.toBeInTheDocument();
  });

  it('keeps the latest file when an earlier arrayBuffer resolves out of order', async () => {
    const firstRead = deferred<ArrayBuffer>();
    const first = new File([fixture02], 'slow-first.NCP', { type: 'application/octet-stream' });
    Object.defineProperty(first, 'arrayBuffer', { value: () => firstRead.promise });
    const { user } = renderFilters();
    const dialog = await openCreate();
    const picker = within(dialog).getByLabelText('NCP 文件');

    await user.upload(picker, first);
    await user.upload(picker, ncpFile(fixture33, 'latest-second.NCP'));
    expect(await within(dialog).findByText('SHING TokugawaTone2')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue('SHING TokugawaTone2');

    await act(async () => {
      firstRead.resolve(fixture02.slice().buffer);
      await firstRead.promise;
    });
    expect(within(dialog).getByText('SHING TokugawaTone2')).toBeInTheDocument();
    expect(within(dialog).getByText('Monochrome')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue('SHING TokugawaTone2');
    expect(within(dialog).queryByText('Fuji Astia')).not.toBeInTheDocument();
  });

  it('keeps the inspected file and all metadata after a single DUPLICATE_NCP request', async () => {
    let posts = 0;
    server.use(http.post('/api/admin/filters', () => {
      posts += 1;
      return HttpResponse.json({
        code: 'DUPLICATE_NCP',
        message: '<b>raw duplicate record</b>',
      }, { status: 409 });
    }));
    const { user } = renderFilters();
    const dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    await within(dialog).findByText('Fuji Astia');
    await user.clear(within(dialog).getByLabelText('显示名称'));
    await user.type(within(dialog).getByLabelText('显示名称'), '保留名称');
    await user.type(within(dialog).getByLabelText('描述（可选）'), '保留描述');
    await user.type(within(dialog).getByLabelText('Slug（可选）'), 'keep-slug');
    await user.clear(within(dialog).getByLabelText('排序'));
    await user.type(within(dialog).getByLabelText('排序'), '9');
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('该 NCP 已经发布，请选择其他文件');
    expect(dialog).not.toHaveTextContent('raw duplicate record');
    expect(within(dialog).getByText('Neutral')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue('保留名称');
    expect(within(dialog).getByLabelText('描述（可选）')).toHaveValue('保留描述');
    expect(within(dialog).getByLabelText('Slug（可选）')).toHaveValue('keep-slug');
    expect(within(dialog).getByLabelText('排序')).toHaveValue(9);
    expect(within(dialog).getByLabelText('NCP 文件')).toBeEnabled();
    expect(posts).toBe(1);
  });

  it('keeps the single-create network failure copy separate from bulk pause copy', async () => {
    server.use(http.post('/api/admin/filters', () => HttpResponse.error()));
    const { user } = renderFilters();
    const dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    await within(dialog).findByText('Fuji Astia');
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('保存失败，请重试');
    expect(dialog).not.toHaveTextContent('网络连接中断，导入已暂停');
    expect(within(dialog).getByText('Neutral')).toBeInTheDocument();
  });

  it('keeps recoverable state without exposing unmatched server validation text', async () => {
    server.use(http.post('/api/admin/filters', () => HttpResponse.json({
      code: 'VALIDATION_ERROR',
      message: '<b>raw validation summary</b>',
      errors: [{ field: 'database', message: '<img src=x onerror=alert(1)>' }],
    }, { status: 400 })));
    const { user } = renderFilters();
    const dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    await within(dialog).findByText('Fuji Astia');
    await user.clear(within(dialog).getByLabelText('显示名称'));
    await user.type(within(dialog).getByLabelText('显示名称'), '保留输入');
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('输入内容有误，请检查后重试');
    expect(dialog).not.toHaveTextContent('raw validation summary');
    expect(dialog).not.toHaveTextContent('onerror');
    expect(within(dialog).getByLabelText('显示名称')).toHaveValue('保留输入');
    expect(within(dialog).getByText('Neutral')).toBeInTheDocument();
  });

  it('mirrors server metadata bounds and never sends invalid input', async () => {
    let posts = 0;
    server.use(http.post('/api/admin/filters', () => {
      posts += 1;
      return HttpResponse.json({ filter: filter() }, { status: 201 });
    }));
    const { user } = renderFilters();
    const dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    await within(dialog).findByText('Fuji Astia');
    await user.clear(within(dialog).getByLabelText('显示名称'));
    await user.type(within(dialog).getByLabelText('显示名称'), 'x'.repeat(101));
    await user.type(within(dialog).getByLabelText('描述（可选）'), 'x'.repeat(501));
    await user.type(within(dialog).getByLabelText('Slug（可选）'), 'Invalid Slug');
    await user.clear(within(dialog).getByLabelText('排序'));
    await user.type(within(dialog).getByLabelText('排序'), '1.5');
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    expect(within(dialog).getByLabelText('显示名称')).toHaveAccessibleDescription('显示名称不能超过 100 个字符');
    expect(within(dialog).getByLabelText('描述（可选）')).toHaveAccessibleDescription('描述不能超过 500 个字符');
    expect(within(dialog).getByLabelText('Slug（可选）')).toHaveAccessibleDescription(/Slug 只能包含小写字母、数字和单个连字符/);
    expect(within(dialog).getByLabelText('排序')).toHaveAccessibleDescription('排序必须是整数');
    expect(posts).toBe(0);
  });

  it('disables every dialog control while pending and prevents duplicate posts', async () => {
    const pending = deferred<Response>();
    let posts = 0;
    server.use(http.post('/api/admin/filters', () => {
      posts += 1;
      return pending.promise;
    }));
    const { user } = renderFilters();
    const dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    await within(dialog).findByText('Fuji Astia');
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));

    await waitFor(() => expect(posts).toBe(1));
    for (const label of ['NCP 文件', '显示名称', '分类', '描述（可选）', 'Slug（可选）', '排序']) {
      expect(within(dialog).getByLabelText(label)).toBeDisabled();
    }
    expect(within(dialog).getByRole('checkbox', { name: '启用滤镜' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '保存滤镜' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '取消' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: '保存滤镜' }));
    expect(posts).toBe(1);

    pending.resolve(HttpResponse.json({ filter: filter() }, { status: 201 }));
    expect(await screen.findByText('滤镜已创建')).toBeInTheDocument();
  });

  it('clears file, preview, and form state whenever the dialog closes', async () => {
    const { user } = renderFilters();
    let dialog = await openCreate();
    await user.upload(within(dialog).getByLabelText('NCP 文件'), ncpFile());
    await within(dialog).findByText('Fuji Astia');
    await user.type(within(dialog).getByLabelText('描述（可选）'), '临时描述');
    await user.click(within(dialog).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog', { name: '新增滤镜' })).not.toBeInTheDocument();

    dialog = await openCreate();
    expect(within(dialog).queryByText('Fuji Astia')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('NCP 文件')).toHaveValue('');
    expect(within(dialog).queryByLabelText('显示名称')).not.toBeInTheDocument();
  });
});
