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
});
