import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

describe('smoke', () => {
  it('constructs a Fastify instance', async () => {
    const app = Fastify();
    app.get('/ping', async () => ({ pong: true }));
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pong: true });
    await app.close();
  });
});
