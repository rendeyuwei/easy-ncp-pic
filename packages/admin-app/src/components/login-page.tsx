import { Navigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { ApiFailure } from '../lib/admin-client';
import { useSession } from '../session/session-provider';
import { Button } from './ui/button';
import { Field } from './ui/field';

export function LoginPage() {
  const { status, login } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (status === 'authenticated') return <Navigate to="/filters" replace />;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await login({ username, password });
      setPassword('');
    } catch (cause) {
      setPassword('');
      setError(cause instanceof ApiFailure && cause.code === 'INVALID_CREDENTIALS'
        ? '用户名或密码不正确'
        : '登录失败，请重试');
    }
  }

  const submitting = status === 'transitioning';
  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">EP</div>
        <p className="eyebrow">EasyPic Admin</p>
        <h1 id="login-title">管理后台登录</h1>
        <p className="login-card__intro">登录后管理滤镜与分类。</p>
        <form className="login-form" onSubmit={(event) => void handleSubmit(event)}>
          <Field label="用户名">
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              required
            />
          </Field>
          <Field label="密码">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </Field>
          {error ? <p className="form-alert" role="alert">{error}</p> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? '正在登录…' : '登录'}
          </Button>
        </form>
      </section>
    </main>
  );
}
