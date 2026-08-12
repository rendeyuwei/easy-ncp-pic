import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, type AdminApi, type Credentials } from '../lib/admin-client';
import { NotificationProvider, useNotifications } from '../components/notification-provider';
import { Field } from '../components/ui/field';
import { PageState, StatusBadge } from '../components/ui/status';
import { renderAdminApp } from './render-app';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  return {
    promise: new Promise<T>((next, fail) => { resolve = next; reject = fail; }),
    resolve,
    reject,
  };
}

function createApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return {
    setUnauthorizedHandler: vi.fn(),
    restoreSession: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    listCategories: vi.fn(async () => []),
    createCategory: vi.fn(async () => { throw new Error('not used'); }),
    updateCategory: vi.fn(async () => { throw new Error('not used'); }),
    deleteCategory: vi.fn(async () => undefined),
    listFilters: vi.fn(async () => []),
    createFilter: vi.fn(async () => { throw new Error('not used'); }),
    updateFilter: vi.fn(async () => { throw new Error('not used'); }),
    deleteFilter: vi.fn(async () => undefined),
    ...overrides,
  };
}

function anonymousApi(overrides: Partial<AdminApi> = {}): AdminApi {
  return createApi({
    restoreSession: vi.fn(async () => {
      throw new ApiFailure(401, 'UNAUTHORIZED', 'Sign in');
    }),
    ...overrides,
  });
}

describe('admin application routing', () => {
  it('redirects /admin to login for an anonymous session', async () => {
    const { history } = renderAdminApp(anonymousApi(), '/admin');

    expect(await screen.findByRole('heading', { name: '管理后台登录' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/admin/login');
  });

  it('redirects /admin to filters for an authenticated session', async () => {
    const { history } = renderAdminApp(createApi(), '/admin');

    expect(await screen.findByRole('heading', { name: '滤镜' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/admin/filters');
  });

  it('does not mount protected category content for a direct anonymous visit', async () => {
    renderAdminApp(anonymousApi(), '/admin/categories');

    expect(await screen.findByRole('heading', { name: '管理后台登录' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '分类' })).not.toBeInTheDocument();
  });

  it('submits actual credentials, clears the password through unmount, and opens filters', async () => {
    const login = vi.fn(async (_input: Credentials) => undefined);
    const { history, user } = renderAdminApp(anonymousApi({ login }), '/admin/login');
    const username = await screen.findByRole('textbox', { name: '用户名' });
    const password = screen.getByLabelText('密码');

    await user.type(username, 'operator');
    await user.type(password, 's3cret!');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(login).toHaveBeenCalledWith({ username: 'operator', password: 's3cret!' });
    expect(await screen.findByRole('heading', { name: '滤镜' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/admin/filters');
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
  });

  it('shows one generic invalid-credentials alert and keeps the username', async () => {
    const login = vi.fn(async () => {
      throw new ApiFailure(401, 'INVALID_CREDENTIALS', 'Internal credential detail');
    });
    const { user } = renderAdminApp(anonymousApi({ login }), '/admin/login');

    await user.type(await screen.findByRole('textbox', { name: '用户名' }), 'operator');
    await user.type(screen.getByLabelText('密码'), 'wrong');
    await user.click(screen.getByRole('button', { name: '登录' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('用户名或密码不正确');
    expect(alerts[0]).not.toHaveTextContent('Internal credential detail');
    expect(screen.getByRole('textbox', { name: '用户名' })).toHaveValue('operator');
  });

  it('offers bootstrap recovery after a network failure and retries successfully', async () => {
    const restoreSession = vi.fn()
      .mockRejectedValueOnce(new ApiFailure(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValueOnce(undefined);
    const { user } = renderAdminApp(createApi({ restoreSession }), '/admin/filters');

    expect(await screen.findByText('无法连接管理服务')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重试' }));

    expect(await screen.findByRole('heading', { name: '滤镜' })).toBeInTheDocument();
    expect(restoreSession).toHaveBeenCalledTimes(2);
  });

  it('renders the authenticated shell controls and controlled mobile navigation', async () => {
    const { user } = renderAdminApp(createApi(), '/admin/filters');

    const navigation = await screen.findByRole('navigation', { name: '主管理导航' });
    expect(within(navigation).getByRole('link', { name: '滤镜' })).toHaveAttribute('aria-current', 'page');
    expect(within(navigation).getByRole('link', { name: '分类' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换为浅色主题' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '打开导航菜单' }));
    const dialog = screen.getByRole('dialog', { name: '管理导航' });
    await user.click(within(dialog).getByRole('link', { name: '分类' }));

    expect(await screen.findByRole('heading', { name: '分类' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '管理导航' })).not.toBeInTheDocument();
  });

  it('redirects unknown admin routes according to the completed session state', async () => {
    const anonymous = renderAdminApp(anonymousApi(), '/admin/missing');
    expect(await screen.findByRole('heading', { name: '管理后台登录' })).toBeInTheDocument();
    expect(anonymous.history.location.pathname).toBe('/admin/login');
    anonymous.unmount();

    const authenticated = renderAdminApp(createApi(), '/admin/missing');
    expect(await screen.findByRole('heading', { name: '滤镜' })).toBeInTheDocument();
    expect(authenticated.history.location.pathname).toBe('/admin/filters');
  });

  it('never mounts protected children while logout is transitioning', async () => {
    const pending = deferred<void>();
    const { user } = renderAdminApp(createApi({ logout: vi.fn(() => pending.promise) }), '/admin/filters');
    await screen.findByRole('heading', { name: '滤镜' });

    await user.click(screen.getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: '滤镜' })).not.toBeInTheDocument());
    pending.resolve(undefined);
  });

  it('keeps the shell visible and reports a generic alert after logout fails', async () => {
    const logout = vi.fn(async () => { throw new ApiFailure(0, 'NETWORK_ERROR', 'server detail'); });
    const { user } = renderAdminApp(createApi({ logout }), '/admin/categories');

    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('heading', { name: '分类' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('退出登录失败，请重试');
    expect(screen.getByRole('alert')).not.toHaveTextContent('server detail');
  });

  it('returns to login after logout succeeds', async () => {
    const logout = vi.fn(async () => undefined);
    const { history, user } = renderAdminApp(createApi({ logout }), '/admin/filters');

    await user.click(await screen.findByRole('button', { name: '退出登录' }));

    expect(await screen.findByRole('heading', { name: '管理后台登录' })).toBeInTheDocument();
    expect(history.location.pathname).toBe('/admin/login');
  });
});

function NotificationProbe() {
  const { notify } = useNotifications();
  return (
    <>
      <button onClick={() => notify('已保存', 'success')}>success</button>
      <button onClick={() => notify('保存失败', 'failure')}>failure</button>
    </>
  );
}

describe('shared administration primitives', () => {
  it('keeps one notification, replaces its live-region tone, and supports dismissal', async () => {
    const user = userEvent.setup();
    render(<NotificationProvider><NotificationProbe /></NotificationProvider>);

    await user.click(screen.getByRole('button', { name: 'success' }));
    expect(screen.getByRole('status')).toHaveTextContent('已保存');
    await user.click(screen.getByRole('button', { name: 'failure' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    await user.click(screen.getByRole('button', { name: '关闭通知' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('connects a field label, description, and error without losing either accessible relation', () => {
    function FieldProbe() {
      const [value, setValue] = useState('');
      return (
        <Field label="显示名称" description="面向访客展示" error="请输入名称">
          <input value={value} onChange={(event) => setValue(event.target.value)} />
        </Field>
      );
    }
    render(<FieldProbe />);

    const input = screen.getByRole('textbox', { name: '显示名称' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('面向访客展示 请输入名称');
  });

  it('renders visible Chinese page and status states', () => {
    render(
      <>
        <PageState kind="loading" />
        <StatusBadge enabled />
        <StatusBadge enabled={false} />
      </>,
    );

    expect(screen.getByText('正在加载…')).toBeInTheDocument();
    expect(screen.getByText('已启用')).toBeInTheDocument();
    expect(screen.getByText('已停用')).toBeInTheDocument();
  });
});
