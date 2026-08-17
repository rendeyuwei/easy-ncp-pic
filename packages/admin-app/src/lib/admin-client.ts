import {
  parseApiErrorBody,
  parseCategoriesResponse,
  parseCategoryResponse,
  parseFilterResponse,
  parseFiltersResponse,
  parseSessionResponse,
  type AdminCategory,
  type AdminFilter,
  type ApiErrorBody,
} from './api-schema';

export interface Credentials {
  username: string;
  password: string;
}

export interface CategoryInput {
  name: string;
  slug?: string;
  sortOrder: number;
  isEnabled: boolean;
}

export interface FilterCreateInput {
  ncpBase64: string;
  displayName: string;
  categoryId: string;
  description?: string;
  slug?: string;
  sortOrder: number;
  isEnabled: boolean;
}

export type FilterPatch = Omit<FilterCreateInput, 'ncpBase64'>;

export interface AdminApi {
  setUnauthorizedHandler(handler: () => void): void;
  restoreSession(): Promise<void>;
  login(input: Credentials): Promise<void>;
  logout(): Promise<void>;
  listCategories(signal?: AbortSignal): Promise<AdminCategory[]>;
  createCategory(input: CategoryInput): Promise<AdminCategory>;
  updateCategory(id: string, input: CategoryInput): Promise<AdminCategory>;
  deleteCategory(id: string): Promise<void>;
  listFilters(signal?: AbortSignal, cache?: RequestCache): Promise<AdminFilter[]>;
  createFilter(input: FilterCreateInput): Promise<AdminFilter>;
  updateFilter(id: string, input: FilterPatch): Promise<AdminFilter>;
  deleteFilter(id: string): Promise<void>;
}

type FieldError = NonNullable<ApiErrorBody['errors']>[number];
type Parser<T> = (value: unknown) => T;

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly errors: FieldError[] | undefined;

  constructor(status: number, code: string, message: string, errors?: FieldError[]) {
    super(message);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

export class AdminApiClient implements AdminApi {
  private csrfToken: string | null = null;
  private restorePromise: Promise<void> | null = null;
  private unauthorizedHandler: () => void = () => undefined;

  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch) {}

  setUnauthorizedHandler(handler: () => void): void {
    this.unauthorizedHandler = handler;
  }

  restoreSession(): Promise<void> {
    if (this.restorePromise) return this.restorePromise;

    const shared = this.performSessionRestoration().finally(() => {
      if (this.restorePromise === shared) this.restorePromise = null;
    });
    this.restorePromise = shared;
    return shared;
  }

  async login(input: Credentials): Promise<void> {
    const response = await this.send('/api/admin/session', this.jsonInit('POST', input));
    if (!response.ok) throw await this.failure(response);

    const session = await this.parseSuccess(response, parseSessionResponse);
    this.csrfToken = session.csrfToken;
  }

  async logout(): Promise<void> {
    await this.mutate<void>('/api/admin/session', { method: 'DELETE' }, null);
    this.csrfToken = null;
  }

  async listCategories(signal?: AbortSignal): Promise<AdminCategory[]> {
    const body = await this.query('/api/admin/categories', parseCategoriesResponse, signal);
    return body.categories;
  }

  async createCategory(input: CategoryInput): Promise<AdminCategory> {
    const body = await this.mutate('/api/admin/categories', this.jsonInit('POST', input), parseCategoryResponse);
    return body.category;
  }

  async updateCategory(id: string, input: CategoryInput): Promise<AdminCategory> {
    const body = await this.mutate(
      `/api/admin/categories/${encodeURIComponent(id)}`,
      this.jsonInit('PATCH', input),
      parseCategoryResponse,
    );
    return body.category;
  }

  deleteCategory(id: string): Promise<void> {
    return this.mutate(
      `/api/admin/categories/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      null,
    );
  }

  async listFilters(signal?: AbortSignal, cache?: RequestCache): Promise<AdminFilter[]> {
    const body = await this.query('/api/admin/filters', parseFiltersResponse, signal, cache);
    return body.filters;
  }

  async createFilter(input: FilterCreateInput): Promise<AdminFilter> {
    const body = await this.mutate('/api/admin/filters', this.jsonInit('POST', input), parseFilterResponse);
    return body.filter;
  }

  async updateFilter(id: string, input: FilterPatch): Promise<AdminFilter> {
    const body = await this.mutate(
      `/api/admin/filters/${encodeURIComponent(id)}`,
      this.jsonInit('PATCH', input),
      parseFilterResponse,
    );
    return body.filter;
  }

  deleteFilter(id: string): Promise<void> {
    return this.mutate(
      `/api/admin/filters/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      null,
    );
  }

  private async performSessionRestoration(): Promise<void> {
    const response = await this.send('/api/admin/session', { method: 'GET' });
    if (!response.ok) {
      const failure = await this.failure(response);
      if (failure.status === 401) this.clearAndNotifyUnauthorized();
      throw failure;
    }

    const session = await this.parseSuccess(response, parseSessionResponse);
    this.csrfToken = session.csrfToken;
  }

  private async query<T>(
    path: string,
    parse: Parser<T>,
    signal?: AbortSignal,
    cache?: RequestCache,
  ): Promise<T> {
    const response = await this.send(path, { method: 'GET', signal, cache });
    if (!response.ok) {
      const failure = await this.failure(response);
      if (failure.status === 401) this.clearAndNotifyUnauthorized();
      throw failure;
    }
    return this.parseSuccess(response, parse);
  }

  private async mutate<T>(path: string, init: RequestInit, parse: Parser<T> | null, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('x-csrf-token', this.requireCsrf());
    const response = await this.send(path, { ...init, headers });

    if (!response.ok) {
      const failure = await this.failure(response);
      if (failure.status === 403 && failure.code === 'CSRF_INVALID' && retry) {
        await this.restoreSession();
        return this.mutate(path, init, parse, false);
      }
      if (failure.status === 401 || (failure.status === 403 && failure.code === 'CSRF_INVALID')) {
        this.clearAndNotifyUnauthorized();
      }
      throw failure;
    }

    if (parse === null) return this.parseNoContent(response) as T;
    return this.parseSuccess(response, parse);
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');

    try {
      return await this.fetchImpl.call(globalThis, path, {
        ...init,
        credentials: 'same-origin',
        headers,
      });
    } catch {
      throw new ApiFailure(0, 'NETWORK_ERROR', 'Unable to reach the server');
    }
  }

  private async failure(response: Response): Promise<ApiFailure> {
    try {
      const body = parseApiErrorBody(await response.json());
      return new ApiFailure(response.status, body.code, body.message, body.errors);
    } catch {
      return new ApiFailure(response.status, 'INVALID_RESPONSE', 'The server returned an invalid response');
    }
  }

  private async parseSuccess<T>(response: Response, parse: Parser<T>): Promise<T> {
    try {
      return parse(await response.json());
    } catch {
      throw new ApiFailure(response.status, 'INVALID_RESPONSE', 'The server returned an invalid response');
    }
  }

  private parseNoContent(response: Response): void {
    if (response.status !== 204) {
      throw new ApiFailure(response.status, 'INVALID_RESPONSE', 'The server returned an invalid response');
    }
  }

  private jsonInit(method: 'POST' | 'PATCH', body: unknown): RequestInit {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  private requireCsrf(): string {
    if (this.csrfToken === null) {
      throw new ApiFailure(401, 'UNAUTHORIZED', 'An authenticated session is required');
    }
    return this.csrfToken;
  }

  private clearAndNotifyUnauthorized(): void {
    this.csrfToken = null;
    this.unauthorizedHandler();
  }
}
