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
    expect(router.state.matches.some((match) => match.routeId.includes('app'))).toBe(true);
  });

  it('matches the same editor under the English prefix and keeps the URL on a later visit', async () => {
    const history = createMemoryHistory({ initialEntries: ['/easypic/?album=1#panel'] });
    const router = createWebRouter(history, '/easypic');

    await router.load();
    await router.navigate({
      href: '/easypic/en/?album=1#panel',
      resetScroll: false,
      hashScrollIntoView: false,
    });

    expect(history.location.pathname).toBe('/easypic/en/');
    expect(history.location.search).toBe('?album=1');
    expect(history.location.hash).toBe('#panel');
    expect(router.state.location.pathname).toBe('/en/');
    expect(router.state.matches.some((match) => match.routeId.includes('app'))).toBe(true);

    await router.navigate({
      href: '/easypic/?album=1&lang=zh#panel',
      resetScroll: false,
      hashScrollIntoView: false,
    });
    expect(history.location.pathname).toBe('/easypic/');
    expect(history.location.search).toBe('?album=1&lang=zh');
    expect(history.location.hash).toBe('#panel');
  });
});
