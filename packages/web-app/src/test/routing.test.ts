import { createMemoryHistory } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { createWebRouter } from '../router';

describe('web application routing', () => {
  it('matches the editor below a custom deployment prefix', async () => {
    const history = createMemoryHistory({ initialEntries: ['/easypic/'] });
    const router = createWebRouter(history, '/easypic');

    await router.load();

    expect(history.location.pathname).toBe('/easypic/');
    expect(router.state.location.pathname).toBe('/');
    expect(router.state.matches.at(-1)?.routeId).toBe('/');
  });

  it('matches the same editor under the English prefix', async () => {
    const history = createMemoryHistory({ initialEntries: ['/easypic/en/?album=1#panel'] });
    const router = createWebRouter(history, '/easypic/en');

    await router.load();

    expect(history.location.pathname).toBe('/easypic/en/');
    expect(history.location.search).toBe('?album=1');
    expect(history.location.hash).toBe('#panel');
    expect(router.state.location.pathname).toBe('/');
  });
});
