import { describe, expect, it, vi } from 'vitest';
import { AdminApiClient, ApiFailure, type CategoryInput, type FilterCreateInput, type FilterPatch } from '../lib/admin-client';
import { categoryFixture, filterFixture } from './fixtures';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestAt(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, index: number) {
  const [url, init = {}] = fetchMock.mock.calls[index];
  return { url: String(url), init, headers: new Headers(init.headers) };
}

async function expectFailure(promise: Promise<unknown>, status: number, code: string): Promise<ApiFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiFailure);
    expect(error).toMatchObject({ status, code });
    return error as ApiFailure;
  }
  throw new Error('Expected AdminApiClient to reject');
}

const categoryInput: CategoryInput = {
  name: '胶片',
  slug: 'film',
  sortOrder: 10,
  isEnabled: true,
};

const filterCreateInput: FilterCreateInput = {
  ncpBase64: 'bmNw',
  displayName: 'Fuji Astia',
  categoryId: categoryFixture.id,
  description: '柔和的胶片风格。',
  slug: 'fuji-astia',
  sortOrder: 20,
  isEnabled: true,
};

const filterPatch: FilterPatch = {
  displayName: 'Fuji Astia II',
  categoryId: categoryFixture.id,
  description: 'Updated',
  slug: 'fuji-astia-ii',
  sortOrder: 21,
  isEnabled: false,
};

describe('AdminApiClient request contract', () => {
  it('calls the default browser fetch with the global receiver', async () => {
    const receiverFetch = vi.fn(function (this: typeof globalThis) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(jsonResponse({ csrfToken: 'restored-token' }));
    });
    vi.stubGlobal('fetch', receiverFetch);

    try {
      const client = new AdminApiClient();

      await expect(client.restoreSession()).resolves.toBeUndefined();
      expect(receiverFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stores the login token, adds it only to mutations, and forwards list cancellation', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-login' }))
      .mockResolvedValueOnce(jsonResponse({ category: categoryFixture }, 201))
      .mockResolvedValueOnce(jsonResponse({ categories: [categoryFixture] }));
    const client = new AdminApiClient(fetchMock);
    const controller = new AbortController();

    await client.login({ username: 'admin', password: 'secret' });
    await expect(client.createCategory(categoryInput)).resolves.toEqual(categoryFixture);
    await expect(client.listCategories(controller.signal)).resolves.toEqual([categoryFixture]);

    const login = requestAt(fetchMock, 0);
    expect(login.url).toBe('/api/admin/session');
    expect(login.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(login.headers.get('accept')).toBe('application/json');
    expect(login.headers.get('content-type')).toBe('application/json');
    expect(login.headers.has('x-csrf-token')).toBe(false);
    expect(login.init.body).toBe(JSON.stringify({ username: 'admin', password: 'secret' }));

    const mutation = requestAt(fetchMock, 1);
    expect(mutation.url).toBe('/api/admin/categories');
    expect(mutation.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(mutation.headers.get('accept')).toBe('application/json');
    expect(mutation.headers.get('content-type')).toBe('application/json');
    expect(mutation.headers.get('x-csrf-token')).toBe('csrf-login');
    expect(mutation.init.body).toBe(JSON.stringify(categoryInput));

    const list = requestAt(fetchMock, 2);
    expect(list.url).toBe('/api/admin/categories');
    expect(list.init).toMatchObject({ method: 'GET', credentials: 'same-origin', signal: controller.signal });
    expect(list.headers.get('accept')).toBe('application/json');
    expect(list.headers.has('content-type')).toBe(false);
    expect(list.headers.has('x-csrf-token')).toBe(false);
  });

  it('deduplicates concurrent session restoration', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    const client = new AdminApiClient(fetchMock);

    const first = client.restoreSession();
    const second = client.restoreSession();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveResponse(jsonResponse({ csrfToken: 'restored-token' }));
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(requestAt(fetchMock, 0)).toMatchObject({
      url: '/api/admin/session',
      init: { method: 'GET', credentials: 'same-origin' },
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ csrfToken: 'newer-token' }));
    await expect(client.restoreSession()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('allows session restoration to retry after a rejected restoration settles', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ code: 'INTERNAL', message: 'Retry later' }, 500))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'restored-token' }));
    const client = new AdminApiClient(fetchMock);

    await expectFailure(client.restoreSession(), 500, 'INTERNAL');
    await expect(client.restoreSession()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('restores once after CSRF_INVALID and replays with the new token', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'stale-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'CSRF_INVALID', message: 'Expired token' }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse({ category: categoryFixture }));
    const unauthorized = vi.fn();
    const client = new AdminApiClient(fetchMock);
    client.setUnauthorizedHandler(unauthorized);

    await client.login({ username: 'admin', password: 'secret' });
    await expect(client.updateCategory('category/film', categoryInput)).resolves.toEqual(categoryFixture);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestAt(fetchMock, 1).headers.get('x-csrf-token')).toBe('stale-token');
    expect(requestAt(fetchMock, 2).url).toBe('/api/admin/session');
    expect(requestAt(fetchMock, 2).init.method).toBe('GET');
    expect(requestAt(fetchMock, 3).headers.get('x-csrf-token')).toBe('fresh-token');
    expect(requestAt(fetchMock, 3).url).toBe('/api/admin/categories/category%2Ffilm');
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('does not retry a second CSRF_INVALID and notifies once', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'stale-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'CSRF_INVALID', message: 'Expired token' }, 403))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'fresh-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'CSRF_INVALID', message: 'Still invalid' }, 403));
    const unauthorized = vi.fn();
    const client = new AdminApiClient(fetchMock);
    client.setUnauthorizedHandler(unauthorized);

    await client.login({ username: 'admin', password: 'secret' });
    await expectFailure(client.deleteCategory('category id'), 403, 'CSRF_INVALID');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    await expectFailure(client.deleteCategory('another category'), 401, 'UNAUTHORIZED');
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('maps error bodies, including field errors, to ApiFailure', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const errorResponse = jsonResponse({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      errors: [{ field: 'name', message: 'Required' }],
    }, 400);
    const jsonSpy = vi.spyOn(errorResponse, 'json');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(errorResponse);
    const client = new AdminApiClient(fetchMock);

    await client.login({ username: 'admin', password: 'secret' });
    const failure = await expectFailure(client.createCategory(categoryInput), 400, 'VALIDATION_ERROR');

    expect(failure.message).toBe('Request validation failed');
    expect(failure.errors).toEqual([{ field: 'name', message: 'Required' }]);
    expect(jsonSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AdminApiClient unauthorized behavior', () => {
  it('clears and notifies once when session restoration returns 401', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'UNAUTHORIZED', message: 'Sign in required' }, 401));
    const unauthorized = vi.fn();
    const client = new AdminApiClient(fetchMock);
    client.setUnauthorizedHandler(unauthorized);

    await client.login({ username: 'admin', password: 'secret' });
    await expectFailure(client.restoreSession(), 401, 'UNAUTHORIZED');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(1);
    await expectFailure(client.createCategory(categoryInput), 401, 'UNAUTHORIZED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('clears and notifies once when a normal list returns 401', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'UNAUTHORIZED', message: 'Sign in required' }, 401));
    const unauthorized = vi.fn();
    const client = new AdminApiClient(fetchMock);
    client.setUnauthorizedHandler(unauthorized);

    await client.login({ username: 'admin', password: 'secret' });
    await expectFailure(client.listFilters(), 401, 'UNAUTHORIZED');

    expect(unauthorized).toHaveBeenCalledTimes(1);
    await expectFailure(client.createCategory(categoryInput), 401, 'UNAUTHORIZED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('clears and notifies once when a mutation returns 401', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ code: 'UNAUTHORIZED', message: 'Sign in required' }, 401));
    const unauthorized = vi.fn();
    const client = new AdminApiClient(fetchMock);
    client.setUnauthorizedHandler(unauthorized);

    await client.login({ username: 'admin', password: 'secret' });
    await expectFailure(client.createFilter(filterCreateInput), 401, 'UNAUTHORIZED');

    expect(unauthorized).toHaveBeenCalledTimes(1);
    await expectFailure(client.createCategory(categoryInput), 401, 'UNAUTHORIZED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the global handler for invalid login credentials', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' }, 401));
    const unauthorized = vi.fn();
    const client = new AdminApiClient(fetchMock);
    client.setUnauthorizedHandler(unauthorized);

    await expectFailure(client.login({ username: 'admin', password: 'wrong' }), 401, 'INVALID_CREDENTIALS');

    expect(unauthorized).not.toHaveBeenCalled();
  });
});

describe('AdminApiClient response handling and wrappers', () => {
  it.each([
    ['deleteCategory', false, (client: AdminApiClient) => client.deleteCategory('category/id')],
    ['logout', true, (client: AdminApiClient) => client.logout()],
  ])('%s accepts 204 without parsing JSON', async (_name, clearsSession, operation) => {
    const fetchMock = vi.fn<typeof fetch>();
    const noContent = new Response(null, { status: 204 });
    const jsonSpy = vi.spyOn(noContent, 'json');
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(noContent);
    const client = new AdminApiClient(fetchMock);

    await client.login({ username: 'admin', password: 'secret' });
    await expect(operation(client)).resolves.toBeUndefined();

    expect(jsonSpy).not.toHaveBeenCalled();
    if (clearsSession) {
      await expectFailure(client.createCategory(categoryInput), 401, 'UNAUTHORIZED');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    }
  });

  it('keeps the token when logout does not return 204', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ unexpected: true }))
      .mockResolvedValueOnce(jsonResponse({ category: categoryFixture }, 201));
    const client = new AdminApiClient(fetchMock);

    await client.login({ username: 'admin', password: 'secret' });
    await expectFailure(client.logout(), 200, 'INVALID_RESPONSE');
    await expect(client.createCategory(categoryInput)).resolves.toEqual(categoryFixture);

    expect(requestAt(fetchMock, 2).headers.get('x-csrf-token')).toBe('csrf-token');
  });

  it('translates malformed success JSON to INVALID_RESPONSE', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response('{not-json', { status: 200 }));
    const client = new AdminApiClient(fetchMock);

    await expectFailure(client.listCategories(), 200, 'INVALID_RESPONSE');
  });

  it('translates an unexpected 204 from a JSON endpoint to INVALID_RESPONSE', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new AdminApiClient(fetchMock);

    await expectFailure(client.listCategories(), 204, 'INVALID_RESPONSE');
  });

  it('translates a rejected fetch to NETWORK_ERROR', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const client = new AdminApiClient(fetchMock);

    await expectFailure(client.listCategories(), 0, 'NETWORK_ERROR');
  });

  it('unwraps filter responses and encodes filter route ids', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ filters: [filterFixture] }))
      .mockResolvedValueOnce(jsonResponse({ filter: filterFixture }, 201))
      .mockResolvedValueOnce(jsonResponse({ filter: { ...filterFixture, displayName: 'Fuji Astia II' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new AdminApiClient(fetchMock);

    await client.login({ username: 'admin', password: 'secret' });
    await expect(client.listFilters()).resolves.toEqual([filterFixture]);
    await expect(client.createFilter(filterCreateInput)).resolves.toEqual(filterFixture);
    await expect(client.updateFilter('filter/id', filterPatch)).resolves.toMatchObject({ displayName: 'Fuji Astia II' });
    await expect(client.deleteFilter('filter/id')).resolves.toBeUndefined();

    expect(requestAt(fetchMock, 1).url).toBe('/api/admin/filters');
    expect(requestAt(fetchMock, 1).init.method).toBe('GET');
    expect(requestAt(fetchMock, 2).init.body).toBe(JSON.stringify(filterCreateInput));
    expect(requestAt(fetchMock, 3).url).toBe('/api/admin/filters/filter%2Fid');
    expect(requestAt(fetchMock, 3).init.body).toBe(JSON.stringify(filterPatch));
    expect(requestAt(fetchMock, 4).url).toBe('/api/admin/filters/filter%2Fid');
  });

  it('encodes category route ids for update and delete', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ category: categoryFixture }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new AdminApiClient(fetchMock);

    await client.login({ username: 'admin', password: 'secret' });
    await client.updateCategory('category/id', categoryInput);
    await client.deleteCategory('category/id');

    expect(requestAt(fetchMock, 1).url).toBe('/api/admin/categories/category%2Fid');
    expect(requestAt(fetchMock, 2).url).toBe('/api/admin/categories/category%2Fid');
  });
});
