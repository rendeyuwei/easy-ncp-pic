import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { ApiError, registerErrorHandler } from '../src/errors';

async function makeApp(throwFn: () => void) {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.get('/boom', () => {
    throwFn();
    return { ok: true };
  });
  await app.ready();
  return app;
}

describe('error handler', () => {
  it('formats an ApiError with its status, code, message, and field errors', async () => {
    const app = await makeApp(() => {
      throw new ApiError(409, 'DUPLICATE_NCP', 'Already exists', [{ field: 'ncp', message: 'dup' }]);
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: 'DUPLICATE_NCP', message: 'Already exists', errors: [{ field: 'ncp', message: 'dup' }] });
    await app.close();
  });

  it('omits errors key when there are none', async () => {
    const app = await makeApp(() => {
      throw new ApiError(404, 'NOT_FOUND', 'Nope');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Nope' });
    await app.close();
  });

  it('maps unknown errors to 500 INTERNAL without leaking internals', async () => {
    const app = await makeApp(() => {
      throw new Error('secret stack detail');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.code).toBe('INTERNAL');
    expect(body.message).toBe('Internal server error');
    expect(JSON.stringify(body)).not.toContain('secret stack detail');
    await app.close();
  });

  it('maps Fastify validation errors to 400 VALIDATION_ERROR with field errors', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    app.post(
      '/v',
      { schema: { body: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false } } },
      async () => ({ ok: true }),
    );
    await app.ready();
    const res = await app.inject({ method: 'POST', url: '/v', payload: {} });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.errors)).toBe(true);
    await app.close();
  });

  it('returns a unified 404 for unknown routes', async () => {
    const app = Fastify({ logger: false });
    registerErrorHandler(app);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('NOT_FOUND');
    await app.close();
  });
});
