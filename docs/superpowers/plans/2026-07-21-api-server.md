# API Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@easypic/api-server`, a Fastify backend exposing the public filter API and the admin API (auth, sessions, CSRF, rate-limiting, NCP upload/validation, filter & category management, health), backed by the existing `@easypic/database` and `@easypic/ncp-parser` packages.

**Architecture:** A Fastify app assembled by `buildApp(ctx)` from an `AppContext` (config + db/repos + SessionService). Security via `@fastify/helmet` (headers), `@fastify/cookie` (HttpOnly session cookie), `@fastify/rate-limit` (login lockout). Admin auth: Argon2id password verify → random session token stored as HMAC-SHA256 hash → session looked up per request; CSRF via a per-session secret returned at login and required in an `X-CSRF-Token` header on mutating routes. NCP upload is JSON with a base64 file: decode → `parseNcp` → reject invalid/unsupported → SHA-256 dedup → store blob+parsed JSON via `FilterRepository`. Unified error envelope `{ code, message, errors? }`.

**Tech Stack:** Fastify 5, `@fastify/cookie`, `@fastify/helmet`, `@fastify/rate-limit`, `@node-rs/argon2` (pure-Rust Argon2id, no native build), workspace deps `@easypic/ncp-parser` + `@easypic/database`; TypeScript (strict, ESM), Vitest, tsup. Integration tests use Fastify `app.inject()` against an in-memory SQLite db.

## Global Constraints

- Node.js **20.19+** or **22.12+**; production **Node.js 22 LTS** (spec §2). Use the project's Node 22 (see Task 0 environment note).
- pnpm; commit the lockfile (spec §2).
- Backend is **Fastify**; production Nginx serves static files and proxies `/api` — the Node app handles `/api` only and listens on a **local** interface (spec §2, §14).
- **No user-photo upload route exists** — the server never receives user photos (spec §5.5, §11).
- Admin writes require a **valid session + same-origin + CSRF protection** (spec §8.2). Sessions use **Secure, HttpOnly, SameSite** cookies; production is **HTTPS-only** (spec §11).
- Admin password is **Argon2id**; session storage keeps **only the hash** of a random token (spec §11, §7.3). Hashing/token-generation live HERE (api-server); the database package stores opaque strings.
- **Login is rate-limited**; consecutive failures trigger a short lockout (spec §11).
- **NCP upload request body is capped at 64 KiB**; first version accepts only NCP 1.00 files whose signature, version, and 638-byte layout pass validation (spec §11) — enforced by calling `parseNcp`.
- Set **CSP, HSTS, `X-Content-Type-Options`, a sensible `Referrer-Policy`** (spec §11) — via `@fastify/helmet`.
- **All SQL is parameterized** (inherited from `@easypic/database`); admin input is escaped on output by context (JSON serialization handles this) (spec §11).
- Error responses use a **unified structure**: `code`, human-readable `message`, optional field `errors` (spec §8.2). Errors are **specific but never leak internal stack traces** (spec §12).
- Corrupt/unknown NCP is rejected with a specific non-leaking error; duplicate NCP is detected by **SHA-256** (spec §12). A SQLite write failure rolls back (inherited from the database package) (spec §12).
- `/api/health` returns process + database health **without exposing sensitive config** (spec §8.1). Public `/api/filters` returns only **enabled** filters' display info + parsed params and supports **ETag/caching** (spec §6.1, §8.1).
- Env vars hold session secret, initial admin config, and data-dir path; real secrets are never committed (spec §14). Provide a migration command (inherited from `@easypic/database`) and a health check (spec §14).

### Design decisions (locked by this plan)

- **NCP upload transport:** JSON body `{ ncpBase64, displayName, categoryId, description?, slug?, sortOrder?, isEnabled? }`. The 638-byte file base64-encodes to <1 KB; the route's Fastify `bodyLimit: 65536` enforces the 64 KiB cap (spec §11). `parseNcp` then enforces the exact 638-byte NCP-1.00 layout.
- **Session token hashing:** `token_hash = HMAC-SHA256(EASYPIC_SESSION_SECRET, token)` — so a leaked db cannot brute-force tokens without the secret (gives the "会话密钥" env var a real purpose, spec §14).
- **CSRF:** per-session `csrf_secret` (stored via `AdminSessionRepository`), returned to the client at login as `csrfToken`; mutating admin routes require an `X-CSRF-Token` header equal to it (timing-safe). Combined with SameSite cookies.
- **Argon2id params** are configurable via env (memory/time/parallelism), defaulting to a safe production baseline and fast test values (spec §11: tuned to the deploy server).
- **Initial admin seeding:** on startup, if no admin exists, create one from `EASYPIC_ADMIN_USERNAME`/`EASYPIC_ADMIN_PASSWORD` (spec §14).

---

## File Structure

```
packages/api-server/
  package.json                       # deps: fastify + plugins + argon2 + workspace pkgs
  tsconfig.json
  tsup.config.ts                     # entries: src/index.ts, src/start.ts
  src/
    index.ts                         # public exports (buildApp, config, db, session, seed, errors)
    start.ts                         # server bootstrap: config -> db -> migrate -> seed -> buildApp -> listen
    config.ts                        # loadConfig(env): AppConfig with validation + defaults
    errors.ts                        # ApiError, ApiErrorCode, registerErrorHandler (unified envelope)
    db.ts                            # initDb(path): { db, repos } via @easypic/database
    app.ts                           # buildApp(ctx): plugins + error handler + route registration
    seed.ts                          # seedInitialAdmin(config, repos)
    auth/
      tokens.ts                      # randomToken, tokenHash (HMAC), safeEqual (timing-safe)
      password.ts                    # hashPassword / verifyPassword (Argon2id via @node-rs/argon2)
      session.ts                     # SessionService: create/findByToken/isValid/touch/revoke
      hooks.ts                       # requireAuth + requireCsrf preHandlers
    routes/
      health.ts                      # GET /api/health
      public-filters.ts              # GET /api/filters (enabled, grouped, ETag)
      admin-auth.ts                  # POST/DELETE /api/admin/session (login/logout + rate-limit)
      admin-categories.ts            # GET/POST/PATCH/DELETE /api/admin/categories
      admin-filters.ts               # GET/POST/PATCH/DELETE /api/admin/filters
  test/
    helpers/build-test-app.ts        # buildTestApp (in-memory db, seeded admin) + login helper
    config.test.ts
    errors.test.ts
    tokens.test.ts
    password.test.ts
    session.test.ts
    health.test.ts
    admin-auth.test.ts
    admin-categories.test.ts
    admin-filters.test.ts
    public-filters.test.ts
```

The test fixtures live in the sibling parser package: `packages/ncp-parser/test/fixtures/PICCON02.NCP` (a genuine, SHA-verified, supported NCP). Admin-filter upload tests read it by relative path.

---

## Task 0: Package scaffold + smoke test

**Files:**
- Create: `packages/api-server/package.json`, `tsconfig.json`, `tsup.config.ts`
- Create: `packages/api-server/src/index.ts` (stub), `test/smoke.test.ts`

**Interfaces:**
- Produces: a workspace package whose toolchain runs green and can construct a Fastify instance. All later tasks build inside `packages/api-server`.

**Environment — Node 22 required.** Prefix every node/pnpm command (same line):
```
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && <command>
```
`@node-rs/argon2` ships prebuilt binaries (no node-gyp). If a dependency version fails to resolve, adjust the caret range to the latest available and note it.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@easypic/api-server",
  "version": "0.1.0",
  "type": "module",
  "description": "Fastify API server for EasyPic: public filter API + admin API.",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsup",
    "start": "node ./dist/start.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": { "node": ">=20.19.0 <21 || >=22.12.0" },
  "dependencies": {
    "@easypic/database": "workspace:*",
    "@easypic/ncp-parser": "workspace:*",
    "@fastify/cookie": "^11.0.1",
    "@fastify/helmet": "^13.0.1",
    "@fastify/rate-limit": "^10.2.1",
    "@node-rs/argon2": "^2.0.2",
    "fastify": "^5.2.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsup": "^8.3.5",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create tsup.config.ts**

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/start.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
```

- [ ] **Step 4: Add a stub entry and smoke test**

`packages/api-server/src/index.ts`:
```ts
export const API_SERVER = '@easypic/api-server';
```

`packages/api-server/test/smoke.test.ts`:
```ts
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
```

- [ ] **Step 5: Install and run the smoke test**

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm install
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test
```
Expected: smoke test passes. If a dependency version won't resolve, adjust the caret range to the latest available, re-install, and note the change.

- [ ] **Step 6: Commit**

```bash
git add packages/api-server pnpm-lock.yaml
git commit -m "chore: scaffold @easypic/api-server package (Fastify + auth deps)"
```

---

## Task 1: Configuration loader

**Files:**
- Create: `packages/api-server/src/config.ts`
- Test: `packages/api-server/test/config.test.ts`

**Interfaces:**
- Produces: `AppConfig` interface and `loadConfig(env?)`. Consumed by every later module.

- [ ] **Step 1: Write the failing test**

`packages/api-server/test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const base = {
  EASYPIC_DB: '/data/app.db',
  EASYPIC_SESSION_SECRET: 'secret',
  EASYPIC_ADMIN_PASSWORD: 'pw',
};

describe('loadConfig', () => {
  it('loads with defaults in development', () => {
    const c = loadConfig({ NODE_ENV: 'development', ...base });
    expect(c.env).toBe('development');
    expect(c.port).toBe(3000);
    expect(c.dbPath).toBe('/data/app.db');
    expect(c.sessionSecret).toBe('secret');
    expect(c.sessionTtlHours).toBe(12);
    expect(c.cookieSecure).toBe(false);
    expect(c.adminUsername).toBe('admin');
    expect(c.adminPassword).toBe('pw');
    expect(c.loginRateLimit.max).toBeGreaterThan(100); // dev: permissive
  });

  it('defaults cookieSecure to true in production', () => {
    const c = loadConfig({ NODE_ENV: 'production', ...base });
    expect(c.cookieSecure).toBe(true);
    expect(c.loginRateLimit.max).toBeLessThanOrEqual(10); // prod: strict
    expect(c.argon2.memoryCost).toBeGreaterThanOrEqual(65536);
  });

  it('honors explicit overrides', () => {
    const c = loadConfig({
      NODE_ENV: 'production',
      ...base,
      PORT: '8080',
      EASYPIC_COOKIE_SECURE: 'false',
      EASYPIC_SESSION_TTL_HOURS: '24',
      EASYPIC_ADMIN_USERNAME: 'root',
      EASYPIC_LOGIN_RATE_MAX: '7',
    });
    expect(c.port).toBe(8080);
    expect(c.cookieSecure).toBe(false);
    expect(c.sessionTtlHours).toBe(24);
    expect(c.adminUsername).toBe('root');
    expect(c.loginRateLimit.max).toBe(7);
  });

  it('throws when EASYPIC_DB is missing', () => {
    expect(() => loadConfig({ EASYPIC_SESSION_SECRET: 's', EASYPIC_ADMIN_PASSWORD: 'p' })).toThrow(/EASYPIC_DB/);
  });

  it('throws when EASYPIC_SESSION_SECRET is missing', () => {
    expect(() => loadConfig({ EASYPIC_DB: '/d.db', EASYPIC_ADMIN_PASSWORD: 'p' })).toThrow(/EASYPIC_SESSION_SECRET/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test config`
Expected: FAIL — `Cannot find module '../src/config'`.

- [ ] **Step 3: Write config.ts**

```ts
export interface AppConfig {
  env: string;
  port: number;
  dbPath: string;
  sessionSecret: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  adminUsername: string;
  adminPassword: string;
  argon2: { memoryCost: number; timeCost: number; parallelism: number };
  loginRateLimit: { max: number; timeWindow: string };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';

  const dbPath = env.EASYPIC_DB;
  if (!dbPath) throw new Error('EASYPIC_DB is required');
  const sessionSecret = env.EASYPIC_SESSION_SECRET;
  if (!sessionSecret) throw new Error('EASYPIC_SESSION_SECRET is required');

  return {
    env: nodeEnv,
    port: Number(env.PORT ?? 3000),
    dbPath,
    sessionSecret,
    sessionTtlHours: Number(env.EASYPIC_SESSION_TTL_HOURS ?? 12),
    cookieSecure: env.EASYPIC_COOKIE_SECURE !== undefined ? env.EASYPIC_COOKIE_SECURE === 'true' : isProd,
    adminUsername: env.EASYPIC_ADMIN_USERNAME ?? 'admin',
    adminPassword: env.EASYPIC_ADMIN_PASSWORD ?? '',
    argon2: {
      memoryCost: Number(env.EASYPIC_ARGON2_MEMORY_KIB ?? (isProd ? 65536 : 1024)),
      timeCost: Number(env.EASYPIC_ARGON2_TIME ?? (isProd ? 3 : 1)),
      parallelism: Number(env.EASYPIC_ARGON2_PARALLELISM ?? 1),
    },
    loginRateLimit: {
      max: Number(env.EASYPIC_LOGIN_RATE_MAX ?? (isProd ? 5 : 1000)),
      timeWindow: env.EASYPIC_LOGIN_RATE_WINDOW ?? '1 minute',
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test config`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/config.ts packages/api-server/test/config.test.ts
git commit -m "feat(api-server): add env config loader with validation and defaults"
```

---

## Task 2: Unified error envelope + error handler

**Files:**
- Create: `packages/api-server/src/errors.ts`
- Test: `packages/api-server/test/errors.test.ts`

**Interfaces:**
- Produces: `ApiErrorCode`, `ApiError(statusCode, code, message, errors?)`, and `registerErrorHandler(app)` which formats all errors as `{ code, message, errors? }` and never leaks stack traces.

- [ ] **Step 1: Write the failing test**

`packages/api-server/test/errors.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test errors`
Expected: FAIL — `Cannot find module '../src/errors'`.

- [ ] **Step 3: Write errors.ts**

```ts
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'UNAUTHORIZED'
  | 'CSRF_INVALID'
  | 'NOT_FOUND'
  | 'DUPLICATE_NCP'
  | 'INVALID_NCP'
  | 'UNSUPPORTED_NCP'
  | 'CATEGORY_IN_USE'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly errors?: Array<{ field: string; message: string }>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  code: ApiErrorCode;
  message: string;
  errors?: Array<{ field: string; message: string }>;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof ApiError) {
      const body: ErrorBody = { code: err.code, message: err.message };
      if (err.errors) body.errors = err.errors;
      return reply.status(err.statusCode).send(body);
    }
    if (err.validation) {
      const errors = err.validation.map((v) => ({
        field: v.instancePath?.replace(/^\//, '') || (v.params as { missingProperty?: string } | undefined)?.missingProperty || 'body',
        message: v.message ?? 'invalid value',
      }));
      return reply.status(400).send({ code: 'VALIDATION_ERROR', message: 'Request validation failed', errors });
    }
    if (err.statusCode === 429) {
      return reply.status(429).send({ code: 'RATE_LIMITED', message: 'Too many requests' });
    }
    if (err.statusCode === 413) {
      return reply.status(413).send({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' });
    }
    req.log.error(err);
    return reply.status(500).send({ code: 'INTERNAL', message: 'Internal server error' });
  });

  app.setNotFoundHandler((_req: FastifyRequest, reply: FastifyReply) => {
    reply.status(404).send({ code: 'NOT_FOUND', message: 'Route not found' });
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test errors`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/errors.ts packages/api-server/test/errors.test.ts
git commit -m "feat(api-server): add unified error envelope and error handler"
```

---

## Task 3: Token utilities (random tokens, HMAC hashing, timing-safe compare)

**Files:**
- Create: `packages/api-server/src/auth/tokens.ts`
- Test: `packages/api-server/test/tokens.test.ts`

**Interfaces:**
- Produces: `randomToken(bytes?)`, `tokenHash(secret, token)` (HMAC-SHA256 hex), `safeEqual(a, b)` (timing-safe). Used by SessionService and CSRF checks.

- [ ] **Step 1: Write the failing test**

`packages/api-server/test/tokens.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { randomToken, tokenHash, safeEqual } from '../src/auth/tokens';

describe('tokens', () => {
  it('randomToken returns hex of the requested byte length and is unique', () => {
    const a = randomToken(32);
    const b = randomToken(32);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('tokenHash is deterministic for the same secret+token', () => {
    expect(tokenHash('s', 'tok')).toBe(tokenHash('s', 'tok'));
  });

  it('tokenHash differs when the secret differs', () => {
    expect(tokenHash('s1', 'tok')).not.toBe(tokenHash('s2', 'tok'));
  });

  it('safeEqual is true for equal strings, false otherwise', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test tokens`
Expected: FAIL — `Cannot find module '../src/auth/tokens'`.

- [ ] **Step 3: Write tokens.ts**

```ts
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

/** A cryptographically-random hex token. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** HMAC-SHA256 hex of a token under the session secret. */
export function tokenHash(secret: string, token: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}

/** Constant-time string equality. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test tokens`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/auth/tokens.ts packages/api-server/test/tokens.test.ts
git commit -m "feat(api-server): add token utilities (random, HMAC hash, timing-safe compare)"
```

---

## Task 4: Argon2id password hashing

**Files:**
- Create: `packages/api-server/src/auth/password.ts`
- Test: `packages/api-server/test/password.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (for argon2 params).
- Produces: `hashPassword(config, password): Promise<string>` (Argon2id PHC string), `verifyPassword(config, hash, password): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

`packages/api-server/test/password.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth/password';
import type { AppConfig } from '../src/config';

const config = {
  env: 'test',
  argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 },
} as unknown as AppConfig;

describe('password (Argon2id)', () => {
  it('hashes to an argon2id PHC string and verifies the correct password', async () => {
    const hash = await hashPassword(config, 'correct horse');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(config, hash, 'correct horse')).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(config, 'right');
    expect(await verifyPassword(config, hash, 'wrong')).toBe(false);
  });

  it('produces different hashes for the same password (salted)', async () => {
    const a = await hashPassword(config, 'same');
    const b = await hashPassword(config, 'same');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test password`
Expected: FAIL — `Cannot find module '../src/auth/password'`.

- [ ] **Step 3: Write password.ts**

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2';
import type { AppConfig } from '../config';

function options(config: AppConfig) {
  return {
    type: Algorithm.Argon2id,
    memoryCost: config.argon2.memoryCost,
    timeCost: config.argon2.timeCost,
    parallelism: config.argon2.parallelism,
  };
}

export async function hashPassword(config: AppConfig, password: string): Promise<string> {
  return hash(password, options(config));
}

export async function verifyPassword(config: AppConfig, hashStr: string, password: string): Promise<boolean> {
  try {
    return await verify(hashStr, password);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test password`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/auth/password.ts packages/api-server/test/password.test.ts
git commit -m "feat(api-server): add Argon2id password hashing and verification"
```

---

## Task 5: Database container (initDb) + SessionService

**Files:**
- Create: `packages/api-server/src/db.ts`, `packages/api-server/src/auth/session.ts`
- Test: `packages/api-server/test/session.test.ts`

**Interfaces:**
- Consumes: `@easypic/database` (`openDatabase`, `migrate`, repositories), `AppConfig`, `tokens.ts`.
- Produces: `initDb(path): AppDb` where `AppDb = { db, repos }` and `repos = { categories, filters, admins, sessions }`; `SessionService` with `create(adminId)`, `findByToken(token)`, `isValid(session, now?)`, `touch(id)`, `revoke(id)`.

- [ ] **Step 1: Write db.ts**

```ts
import {
  openDatabase,
  migrate,
  CategoryRepository,
  FilterRepository,
  AdminRepository,
  AdminSessionRepository,
} from '@easypic/database';

type Db = ReturnType<typeof openDatabase>;

export interface Repos {
  categories: CategoryRepository;
  filters: FilterRepository;
  admins: AdminRepository;
  sessions: AdminSessionRepository;
}

export interface AppDb {
  db: Db;
  repos: Repos;
}

/** Open the SQLite database, apply migrations, and build the repositories. */
export function initDb(path: string): AppDb {
  const db = openDatabase(path);
  migrate(db);
  return {
    db,
    repos: {
      categories: new CategoryRepository(db),
      filters: new FilterRepository(db),
      admins: new AdminRepository(db),
      sessions: new AdminSessionRepository(db),
    },
  };
}
```

- [ ] **Step 2: Write the failing SessionService test**

`packages/api-server/test/session.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDb } from '../src/db';
import { SessionService } from '../src/auth/session';
import type { AppConfig } from '../src/config';

const config = {
  sessionSecret: 'test-secret',
  sessionTtlHours: 1,
} as unknown as AppConfig;

let db: ReturnType<typeof initDb>;
let sessions: SessionService;
let adminId: string;

beforeEach(() => {
  db = initDb(':memory:');
  adminId = db.repos.admins.create({ username: 'admin', passwordHash: 'x' }).id;
  sessions = new SessionService(config, db.repos);
});
afterEach(() => db.db.close());

describe('SessionService', () => {
  it('create stores a hashed token (not the raw token) and returns token + csrfToken', () => {
    const created = sessions.create(adminId);
    expect(created.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.csrfToken).toMatch(/^[0-9a-f]{64}$/);
    expect(created.expiresAt).toBeTruthy();
    // The raw token is NOT stored; only its HMAC hash is.
    const rows = db.db.prepare('SELECT token_hash FROM admin_sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(created.token);
  });

  it('findByToken resolves the session for the raw token only', () => {
    const created = sessions.create(adminId);
    expect(sessions.findByToken(created.token)?.adminId).toBe(adminId);
    expect(sessions.findByToken('deadbeef')).toBeNull();
  });

  it('isValid is true before expiry and false after', () => {
    const created = sessions.create(adminId);
    const session = sessions.findByToken(created.token)!;
    expect(sessions.isValid(session, new Date())).toBe(true);
    const future = new Date(Date.now() + 2 * 3600 * 1000); // beyond 1h TTL
    expect(sessions.isValid(session, future)).toBe(false);
  });

  it('revoke removes the session', () => {
    const created = sessions.create(adminId);
    const session = sessions.findByToken(created.token)!;
    sessions.revoke(session.id);
    expect(sessions.findByToken(created.token)).toBeNull();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test session`
Expected: FAIL — `Cannot find module '../src/auth/session'`.

- [ ] **Step 4: Write session.ts**

```ts
import type { AdminSessionRecord } from '@easypic/database';
import type { AppConfig } from '../config';
import type { Repos } from '../db';
import { randomToken, tokenHash } from './tokens';

export interface CreatedSession {
  /** Raw token to place in the HttpOnly cookie. */
  token: string;
  /** CSRF secret to return to the client. */
  csrfToken: string;
  /** ISO expiry of the session. */
  expiresAt: string;
}

export class SessionService {
  constructor(
    private readonly config: AppConfig,
    private readonly repos: Repos,
  ) {}

  create(adminId: string): CreatedSession {
    const token = randomToken(32);
    const csrfToken = randomToken(32);
    const expiresAt = new Date(Date.now() + this.config.sessionTtlHours * 3600 * 1000).toISOString();
    this.repos.sessions.create({
      adminId,
      tokenHash: tokenHash(this.config.sessionSecret, token),
      csrfSecret: csrfToken,
      expiresAt,
    });
    return { token, csrfToken, expiresAt };
  }

  findByToken(token: string): AdminSessionRecord | null {
    return this.repos.sessions.findByTokenHash(tokenHash(this.config.sessionSecret, token));
  }

  isValid(session: AdminSessionRecord, now: Date = new Date()): boolean {
    return session.expiresAt > now.toISOString();
  }

  touch(id: string): void {
    this.repos.sessions.touch(id);
  }

  revoke(id: string): void {
    this.repos.sessions.delete(id);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test session`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api-server/src/db.ts packages/api-server/src/auth/session.ts packages/api-server/test/session.test.ts
git commit -m "feat(api-server): add database container and SessionService"
```

---

## Task 6: App assembly (buildApp) + test helper + health route

**Files:**
- Create: `packages/api-server/src/app.ts`, `packages/api-server/src/routes/health.ts`, `packages/api-server/test/helpers/build-test-app.ts`
- Test: `packages/api-server/test/health.test.ts`

**Interfaces:**
- Consumes: `AppConfig`, `AppDb`, `SessionService`, `registerErrorHandler`, plugins.
- Produces: `AppContext { config, db, sessions }`; `buildApp(ctx): Promise<FastifyInstance>` (registers helmet, cookie, rate-limit[global:false], error handler, and the health route — later tasks add their route registrations here); `test/helpers/build-test-app.ts` with `buildTestApp(config?)` (in-memory db + seeded admin) and `login(app, username?, password?)`.

- [ ] **Step 1: Write the health route**

`packages/api-server/src/routes/health.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get('/api/health', async (_req, reply) => {
    let dbOk = true;
    try {
      ctx.db.db.prepare('SELECT 1').get();
    } catch {
      dbOk = false;
    }
    return reply.code(dbOk ? 200 : 503).send({ status: dbOk ? 'ok' : 'error', database: dbOk ? 'ok' : 'error' });
  });
}
```

- [ ] **Step 2: Write app.ts (v1 — plugins + error handler + health)**

`packages/api-server/src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { AppConfig } from './config';
import type { AppDb } from './db';
import type { SessionService } from './auth/session';
import { registerErrorHandler } from './errors';
import { registerHealthRoutes } from './routes/health';

export interface AppContext {
  config: AppConfig;
  db: AppDb;
  sessions: SessionService;
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: ctx.config.env !== 'test', bodyLimit: 1024 * 1024 });

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) => ({
      code: 'RATE_LIMITED',
      message: `Too many requests, retry in ${context.after}`,
    }),
  });

  registerErrorHandler(app);
  registerHealthRoutes(app, ctx);

  return app;
}
```

- [ ] **Step 3: Write the test helper**

`packages/api-server/test/helpers/build-test-app.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppContext } from '../../src/app';
import { initDb, type AppDb } from '../../src/db';
import { SessionService } from '../../src/auth/session';
import { hashPassword } from '../../src/auth/password';
import type { AppConfig } from '../../src/config';

export const TEST_PASSWORD = 'test-password-123';

export function testConfig(over: Partial<AppConfig> = {}): AppConfig {
  return {
    env: 'test',
    port: 0,
    dbPath: ':memory:',
    sessionSecret: 'test-session-secret',
    sessionTtlHours: 12,
    cookieSecure: false,
    adminUsername: 'admin',
    adminPassword: TEST_PASSWORD,
    argon2: { memoryCost: 1024, timeCost: 1, parallelism: 1 },
    loginRateLimit: { max: 1000, timeWindow: '1 minute' },
    ...over,
  };
}

export interface TestApp {
  app: FastifyInstance;
  db: AppDb;
  config: AppConfig;
  ctx: AppContext;
}

export async function buildTestApp(config: AppConfig = testConfig()): Promise<TestApp> {
  const db = initDb(config.dbPath);
  const passwordHash = await hashPassword(config, config.adminPassword);
  db.repos.admins.create({ username: config.adminUsername, passwordHash });
  const sessions = new SessionService(config, db.repos);
  const ctx: AppContext = { config, db, sessions };
  const app = await buildApp(ctx);
  await app.ready();
  return { app, db, config, ctx };
}

export interface LoginResult {
  status: number;
  cookie: string; // "sid=..." (the cookie header value to send back)
  csrfToken: string;
}

export async function login(
  app: FastifyInstance,
  username = 'admin',
  password = TEST_PASSWORD,
): Promise<LoginResult> {
  const res = await app.inject({ method: 'POST', url: '/api/admin/session', payload: { username, password } });
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = (raw ?? '').split(';')[0];
  const body = res.json() as { csrfToken?: string };
  return { status: res.statusCode, cookie, csrfToken: body.csrfToken ?? '' };
}
```
(Note: `login` will only work once Task 7 adds the login route; it is defined here so later tests can import it. The health test below does not call it.)

- [ ] **Step 4: Write the failing health test**

`packages/api-server/test/health.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, type TestApp } from './helpers/build-test-app';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

describe('GET /api/health', () => {
  it('returns ok with database status and no sensitive config', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', database: 'ok' });
    expect(res.body).not.toContain('test-session-secret');
  });

  it('sets security headers (helmet)', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test health`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api-server/src/app.ts packages/api-server/src/routes/health.ts \
  packages/api-server/test/helpers/build-test-app.ts packages/api-server/test/health.test.ts
git commit -m "feat(api-server): add app assembly, test helper, and health route with security headers"
```

---

## Task 7: Auth hooks + initial-admin seed + login/logout (rate-limited)

**Files:**
- Create: `packages/api-server/src/auth/hooks.ts`, `packages/api-server/src/seed.ts`, `packages/api-server/src/routes/admin-auth.ts`
- Modify: `packages/api-server/src/app.ts` (create hooks + register admin-auth routes)
- Test: `packages/api-server/test/admin-auth.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `SessionService`, `verifyPassword`, `tokens.safeEqual`, `ApiError`, config.
- Produces: `createAuthHooks(ctx) -> { requireAuth, requireCsrf }` (Fastify preHandlers; augment `FastifyRequest` with `session?`); `seedInitialAdmin(config, repos)`; the `POST/DELETE /api/admin/session` routes. The session cookie name is `sid`.

- [ ] **Step 1: Write hooks.ts**

```ts
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AdminSessionRecord } from '@easypic/database';
import { ApiError } from '../errors';
import { safeEqual } from './tokens';
import type { AppContext } from '../app';

export const SESSION_COOKIE = 'sid';
export const CSRF_HEADER = 'x-csrf-token';

declare module 'fastify' {
  interface FastifyRequest {
    session?: AdminSessionRecord;
  }
}

export interface AuthHooks {
  requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  requireCsrf: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function createAuthHooks(ctx: AppContext): AuthHooks {
  return {
    async requireAuth(req, _reply) {
      const token = req.cookies?.[SESSION_COOKIE];
      if (!token) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
      const session = ctx.sessions.findByToken(token);
      if (!session || !ctx.sessions.isValid(session)) {
        if (session) ctx.sessions.revoke(session.id);
        throw new ApiError(401, 'UNAUTHORIZED', 'Session invalid or expired');
      }
      ctx.sessions.touch(session.id);
      req.session = session;
    },
    async requireCsrf(req, _reply) {
      const session = req.session;
      if (!session) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required');
      const provided = req.headers[CSRF_HEADER];
      if (typeof provided !== 'string' || !safeEqual(provided, session.csrfSecret)) {
        throw new ApiError(403, 'CSRF_INVALID', 'Invalid CSRF token');
      }
    },
  };
}
```

- [ ] **Step 2: Write seed.ts**

```ts
import type { AppConfig } from './config';
import type { Repos } from './db';
import { hashPassword } from './auth/password';

/** Create the initial admin from config if no admin exists yet (spec §14). */
export async function seedInitialAdmin(config: AppConfig, repos: Repos): Promise<void> {
  if (repos.admins.findByUsername(config.adminUsername)) return;
  if (!config.adminPassword) {
    throw new Error(
      `No admin '${config.adminUsername}' exists and EASYPIC_ADMIN_PASSWORD is not set; cannot seed the initial admin`,
    );
  }
  const passwordHash = await hashPassword(config, config.adminPassword);
  repos.admins.create({ username: config.adminUsername, passwordHash });
}
```

- [ ] **Step 3: Write admin-auth.ts**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import type { AuthHooks } from '../auth/hooks';
import { SESSION_COOKIE } from '../auth/hooks';
import { verifyPassword } from '../auth/password';
import { ApiError } from '../errors';

export function registerAdminAuthRoutes(app: FastifyInstance, ctx: AppContext, hooks: AuthHooks): void {
  app.post(
    '/api/admin/session',
    {
      config: { rateLimit: { max: ctx.config.loginRateLimit.max, timeWindow: ctx.config.loginRateLimit.timeWindow } },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string' }, password: { type: 'string' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body as { username: string; password: string };
      const admin = ctx.db.repos.admins.findByUsername(username);
      const ok = admin ? await verifyPassword(ctx.config, admin.passwordHash, password) : false;
      if (!admin || !ok) {
        throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid username or password');
      }
      const created = ctx.sessions.create(admin.id);
      reply.setCookie(SESSION_COOKIE, created.token, {
        path: '/',
        httpOnly: true,
        secure: ctx.config.cookieSecure,
        sameSite: 'lax',
        expires: new Date(created.expiresAt),
      });
      return reply.code(200).send({ csrfToken: created.csrfToken });
    },
  );

  app.delete(
    '/api/admin/session',
    { preHandler: [hooks.requireAuth, hooks.requireCsrf] },
    async (req, reply) => {
      ctx.sessions.revoke(req.session!.id);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return reply.code(204).send();
    },
  );
}
```

- [ ] **Step 4: Wire admin-auth into app.ts**

In `packages/api-server/src/app.ts`, add imports near the other route imports:
```ts
import { createAuthHooks } from './auth/hooks';
import { registerAdminAuthRoutes } from './routes/admin-auth';
```
And inside `buildApp`, immediately after the `registerHealthRoutes(app, ctx);` line, add:
```ts
  const hooks = createAuthHooks(ctx);
  registerAdminAuthRoutes(app, ctx, hooks);
```
(Later tasks add their route registrations after these two lines.)

- [ ] **Step 5: Write the failing auth test**

`packages/api-server/test/admin-auth.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, testConfig, login, TEST_PASSWORD, type TestApp } from './helpers/build-test-app';
import { seedInitialAdmin } from '../src/seed';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

describe('POST /api/admin/session (login)', () => {
  it('logs in with valid credentials, sets an HttpOnly sid cookie, and returns a csrfToken', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: TEST_PASSWORD } });
    expect(res.statusCode).toBe(200);
    expect(res.json().csrfToken).toMatch(/^[0-9a-f]{64}$/);
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('sid=');
    expect(setCookie.toLowerCase()).toContain('httponly');
    expect(setCookie.toLowerCase()).toContain('samesite=lax');
  });

  it('rejects wrong password with 401 INVALID_CREDENTIALS and no cookie', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('rejects unknown username the same way (no user enumeration)', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'ghost', password: 'x' } });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 VALIDATION_ERROR when fields are missing', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('locks out after too many failures (rate limit)', async () => {
    t = await buildTestApp(testConfig({ loginRateLimit: { max: 3, timeWindow: '1 minute' } }));
    for (let i = 0; i < 3; i++) {
      await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: 'bad' } });
    }
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/session', payload: { username: 'admin', password: 'bad' } });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('RATE_LIMITED');
  });
});

describe('DELETE /api/admin/session (logout)', () => {
  it('logs out with a valid session + CSRF token, clearing the cookie', async () => {
    t = await buildTestApp();
    const { cookie, csrfToken } = await login(t.app);
    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/session', headers: { cookie, 'x-csrf-token': csrfToken } });
    expect(res.statusCode).toBe(204);
  });

  it('requires authentication (no cookie -> 401)', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/session' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('UNAUTHORIZED');
  });

  it('requires a valid CSRF token (403 without it)', async () => {
    t = await buildTestApp();
    const { cookie } = await login(t.app);
    const res = await t.app.inject({ method: 'DELETE', url: '/api/admin/session', headers: { cookie, 'x-csrf-token': 'wrong' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('CSRF_INVALID');
  });
});

describe('seedInitialAdmin', () => {
  it('creates the admin when none exists and is idempotent', async () => {
    t = await buildTestApp();
    // buildTestApp already created 'admin'; seeding again must not duplicate.
    await seedInitialAdmin(t.config, t.db.repos);
    const admins = t.db.db.prepare('SELECT COUNT(*) AS n FROM admins').get() as { n: number };
    expect(admins.n).toBe(1);
  });
});
```

- [ ] **Step 6: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test admin-auth`
Expected: PASS (8 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/api-server/src/auth/hooks.ts packages/api-server/src/seed.ts \
  packages/api-server/src/routes/admin-auth.ts packages/api-server/src/app.ts \
  packages/api-server/test/admin-auth.test.ts
git commit -m "feat(api-server): add auth hooks, admin seeding, and rate-limited login/logout"
```

---

## Task 8: Admin category management

**Files:**
- Create: `packages/api-server/src/routes/admin-categories.ts`
- Modify: `packages/api-server/src/app.ts` (register category routes)
- Test: `packages/api-server/test/admin-categories.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `AuthHooks`, `CategoryRepository`, `ApiError`.
- Produces: `GET/POST/PATCH/DELETE /api/admin/categories` (all behind `requireAuth`; mutating behind `requireCsrf`). Deleting a category still referenced by a filter returns `409 CATEGORY_IN_USE`.

- [ ] **Step 1: Write admin-categories.ts**

```ts
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app';
import type { AuthHooks } from '../auth/hooks';
import { ApiError } from '../errors';

export function registerAdminCategoryRoutes(app: FastifyInstance, ctx: AppContext, hooks: AuthHooks): void {
  const cats = ctx.db.repos.categories;

  app.get('/api/admin/categories', { preHandler: [hooks.requireAuth] }, async () => {
    return { categories: cats.listAll() };
  });

  app.post(
    '/api/admin/categories',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' }, slug: { type: 'string' }, sortOrder: { type: 'integer' }, isEnabled: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const b = req.body as { name: string; slug?: string; sortOrder?: number; isEnabled?: boolean };
      const category = cats.create({ name: b.name, slug: b.slug, sortOrder: b.sortOrder, isEnabled: b.isEnabled });
      return reply.code(201).send({ category });
    },
  );

  app.patch(
    '/api/admin/categories/:id',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      schema: {
        body: {
          type: 'object',
          properties: { name: { type: 'string' }, slug: { type: 'string' }, sortOrder: { type: 'integer' }, isEnabled: { type: 'boolean' } },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as { name?: string; slug?: string; sortOrder?: number; isEnabled?: boolean };
      const category = cats.update(id, b);
      if (!category) throw new ApiError(404, 'NOT_FOUND', 'Category not found');
      return { category };
    },
  );

  app.delete('/api/admin/categories/:id', { preHandler: [hooks.requireAuth, hooks.requireCsrf] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const deleted = cats.delete(id);
      if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Category not found');
    } catch (e) {
      if (e instanceof ApiError) throw e;
      if ((e as { code?: string }).code?.includes('SQLITE_CONSTRAINT')) {
        throw new ApiError(409, 'CATEGORY_IN_USE', 'Cannot delete a category that still has filters');
      }
      throw e;
    }
    return reply.code(204).send();
  });
}
```

- [ ] **Step 2: Wire into app.ts**

In `src/app.ts`, add the import:
```ts
import { registerAdminCategoryRoutes } from './routes/admin-categories';
```
And inside `buildApp`, after the `registerAdminAuthRoutes(app, ctx, hooks);` line, add:
```ts
  registerAdminCategoryRoutes(app, ctx, hooks);
```

- [ ] **Step 3: Write the failing test**

`packages/api-server/test/admin-categories.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { buildTestApp, login, type TestApp } from './helpers/build-test-app';

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

async function authed() {
  t = await buildTestApp();
  const { cookie, csrfToken } = await login(t.app);
  return { cookie, csrf: { 'x-csrf-token': csrfToken } };
}

describe('admin categories', () => {
  it('requires auth to list', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/admin/categories' });
    expect(res.statusCode).toBe(401);
  });

  it('creates a category (201) with auth + CSRF', async () => {
    const { cookie, csrf } = await authed();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.category.name).toBe('Film');
    expect(body.category.slug).toBe('film');
  });

  it('rejects create without CSRF (403)', async () => {
    const { cookie } = await authed();
    const res = await t.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie }, payload: { name: 'X' } });
    expect(res.statusCode).toBe(403);
  });

  it('lists, updates, and deletes a category', async () => {
    const { cookie, csrf } = await authed();
    const created = await t.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
    const id = created.json().category.id as string;

    const list = await t.app.inject({ method: 'GET', url: '/api/admin/categories', headers: { cookie } });
    expect(list.json().categories).toHaveLength(1);

    const patched = await t.app.inject({ method: 'PATCH', url: `/api/admin/categories/${id}`, headers: { cookie, ...csrf }, payload: { name: 'Cinema', isEnabled: false } });
    expect(patched.json().category.name).toBe('Cinema');
    expect(patched.json().category.isEnabled).toBe(false);

    const del = await t.app.inject({ method: 'DELETE', url: `/api/admin/categories/${id}`, headers: { cookie, ...csrf } });
    expect(del.statusCode).toBe(204);
  });

  it('returns 404 when patching a missing category', async () => {
    const { cookie, csrf } = await authed();
    const res = await t.app.inject({ method: 'PATCH', url: '/api/admin/categories/nope', headers: { cookie, ...csrf }, payload: { name: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 CATEGORY_IN_USE when deleting a category that has filters', async () => {
    const { cookie, csrf } = await authed();
    const cat = await t.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
    const catId = cat.json().category.id as string;
    // Insert a filter referencing the category directly via the repository.
    t.db.repos.filters.create({
      displayName: 'F', sourceName: 'F', categoryId: catId,
      ncpBlob: new Uint8Array([1]), ncpSha256: 'sha-1', parserVersion: 1, parsedJson: '{}',
    });
    const del = await t.app.inject({ method: 'DELETE', url: `/api/admin/categories/${catId}`, headers: { cookie, ...csrf } });
    expect(del.statusCode).toBe(409);
    expect(del.json().code).toBe('CATEGORY_IN_USE');
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test admin-categories`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/routes/admin-categories.ts packages/api-server/src/app.ts \
  packages/api-server/test/admin-categories.test.ts
git commit -m "feat(api-server): add admin category management routes"
```

---

## Task 9: NCP upload + create filter

**Files:**
- Create: `packages/api-server/src/routes/admin-filters.ts`
- Modify: `packages/api-server/src/app.ts` (register filter routes)
- Test: `packages/api-server/test/admin-filters.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `AuthHooks`, `FilterRepository`, `parseNcp`/`NcpParseError` (`@easypic/ncp-parser`), `ApiError`.
- Produces: `POST /api/admin/filters` (bodyLimit 64 KiB): decode base64 → `parseNcp` → reject invalid (422 INVALID_NCP) / unsupported (422 UNSUPPORTED_NCP) → SHA-256 dedup (409 DUPLICATE_NCP) → create (201). Also `GET /api/admin/filters` (list all). PATCH/DELETE are added in Task 10 (this file will grow).

- [ ] **Step 1: Write admin-filters.ts (create + list)**

```ts
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { parseNcp, NcpParseError } from '@easypic/ncp-parser';
import type { AppContext } from '../app';
import type { AuthHooks } from '../auth/hooks';
import { ApiError } from '../errors';

export const MAX_NCP_BYTES = 64 * 1024;

export function registerAdminFilterRoutes(app: FastifyInstance, ctx: AppContext, hooks: AuthHooks): void {
  const filters = ctx.db.repos.filters;

  app.get('/api/admin/filters', { preHandler: [hooks.requireAuth] }, async () => {
    return { filters: filters.listAll() };
  });

  app.post(
    '/api/admin/filters',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      bodyLimit: MAX_NCP_BYTES,
      schema: {
        body: {
          type: 'object',
          required: ['ncpBase64', 'displayName', 'categoryId'],
          properties: {
            ncpBase64: { type: 'string' },
            displayName: { type: 'string' },
            categoryId: { type: 'string' },
            description: { type: 'string' },
            slug: { type: 'string' },
            sortOrder: { type: 'integer' },
            isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const b = req.body as {
        ncpBase64: string; displayName: string; categoryId: string;
        description?: string; slug?: string; sortOrder?: number; isEnabled?: boolean;
      };

      const bytes = new Uint8Array(Buffer.from(b.ncpBase64, 'base64'));
      if (bytes.length === 0) {
        throw new ApiError(422, 'INVALID_NCP', 'Empty NCP data');
      }

      let parsed: ReturnType<typeof parseNcp>;
      try {
        parsed = parseNcp(bytes);
      } catch (e) {
        if (e instanceof NcpParseError) {
          throw new ApiError(422, 'INVALID_NCP', `Invalid NCP file (${e.code})`);
        }
        throw e;
      }
      if (!parsed.supported) {
        throw new ApiError(422, 'UNSUPPORTED_NCP', 'Unsupported NCP variant');
      }

      const ncpSha256 = createHash('sha256').update(bytes).digest('hex');
      const existing = filters.findBySha256(ncpSha256);
      if (existing) {
        throw new ApiError(409, 'DUPLICATE_NCP', `This Picture Control is already published as "${existing.displayName}"`);
      }

      try {
        const filter = filters.create({
          displayName: b.displayName,
          sourceName: parsed.sourceName,
          description: b.description ?? '',
          categoryId: b.categoryId,
          slug: b.slug,
          sortOrder: b.sortOrder,
          isEnabled: b.isEnabled,
          ncpBlob: bytes,
          ncpSha256,
          parserVersion: parsed.schemaVersion,
          parsedJson: JSON.stringify(parsed),
        });
        return reply.code(201).send({ filter });
      } catch (e) {
        if ((e as { code?: string }).code?.includes('SQLITE_CONSTRAINT')) {
          throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid category');
        }
        throw e;
      }
    },
  );
}
```

- [ ] **Step 2: Wire into app.ts**

In `src/app.ts`, add the import:
```ts
import { registerAdminFilterRoutes } from './routes/admin-filters';
```
And inside `buildApp`, after the `registerAdminCategoryRoutes(app, ctx, hooks);` line, add:
```ts
  registerAdminFilterRoutes(app, ctx, hooks);
```

- [ ] **Step 3: Write the failing test**

`packages/api-server/test/admin-filters.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTestApp, login, type TestApp } from './helpers/build-test-app';

const here = dirname(fileURLToPath(import.meta.url));
const PICCON02 = join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP');
const ncpBase64 = () => readFileSync(PICCON02).toString('base64');

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

async function authedWithCategory() {
  t = await buildTestApp();
  const { cookie, csrfToken } = await login(t.app);
  const csrf = { 'x-csrf-token': csrfToken };
  const cat = await t.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
  return { cookie, csrf, categoryId: cat.json().category.id as string };
}

describe('POST /api/admin/filters (NCP upload)', () => {
  it('uploads a valid NCP and stores it (201)', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    const res = await t!.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId },
    });
    expect(res.statusCode).toBe(201);
    const f = res.json().filter;
    expect(f.displayName).toBe('Fuji Astia');
    expect(f.sourceName).toBe('Fuji Astia'); // from the NCP itself
    expect(f.parserVersion).toBe(1);
    expect(JSON.parse(f.parsedJson).sourceName).toBe('Fuji Astia');
    // The raw blob is stored and retrievable.
    expect(t!.db.repos.filters.getNcpBlob(f.id)).toBeInstanceOf(Uint8Array);
  });

  it('rejects an invalid NCP with 422 INVALID_NCP (no stack leak)', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    const garbage = Buffer.from('not a real ncp file at all').toString('base64');
    const res = await t!.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: garbage, displayName: 'X', categoryId },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('INVALID_NCP');
    expect(res.body).not.toContain(' at ');
  });

  it('detects a duplicate NCP by SHA-256 (409 DUPLICATE_NCP)', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    const payload = { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId };
    const first = await t!.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload });
    expect(first.statusCode).toBe(201);
    const second = await t!.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe('DUPLICATE_NCP');
  });

  it('rejects an invalid category with 400', async () => {
    const { cookie, csrf } = await authedWithCategory();
    const res = await t!.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: ncpBase64(), displayName: 'X', categoryId: 'missing-cat' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('enforces the 64 KiB body limit (413)', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    const res = await t!.app.inject({
      method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
      payload: { ncpBase64: 'A'.repeat(70000), displayName: 'X', categoryId },
    });
    expect(res.statusCode).toBe(413);
  });

  it('returns 400 VALIDATION_ERROR when required fields are missing', async () => {
    const { cookie, csrf } = await authedWithCategory();
    const res = await t!.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { displayName: 'X' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it('lists filters for an admin (GET)', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    await t!.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId } });
    const res = await t!.app.inject({ method: 'GET', url: '/api/admin/filters', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json().filters).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test admin-filters`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/routes/admin-filters.ts packages/api-server/src/app.ts \
  packages/api-server/test/admin-filters.test.ts
git commit -m "feat(api-server): add NCP upload (validate/dedup/store) and filter listing"
```

---

## Task 10: Filter edit + delete

**Files:**
- Modify: `packages/api-server/src/routes/admin-filters.ts` (add PATCH + DELETE)
- Test: extend `packages/api-server/test/admin-filters.test.ts`

**Interfaces:**
- Consumes: existing `admin-filters.ts`, `FilterRepository.update/delete`.
- Produces: `PATCH /api/admin/filters/:id` (edit display/description/category/sort/enabled/slug) and `DELETE /api/admin/filters/:id`.

- [ ] **Step 1: Add PATCH + DELETE to admin-filters.ts**

Inside `registerAdminFilterRoutes`, after the `app.post('/api/admin/filters', ...)` block, add:
```ts
  app.patch(
    '/api/admin/filters/:id',
    {
      preHandler: [hooks.requireAuth, hooks.requireCsrf],
      schema: {
        body: {
          type: 'object',
          properties: {
            displayName: { type: 'string' },
            description: { type: 'string' },
            categoryId: { type: 'string' },
            slug: { type: 'string' },
            sortOrder: { type: 'integer' },
            isEnabled: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const b = req.body as { displayName?: string; description?: string; categoryId?: string; slug?: string; sortOrder?: number; isEnabled?: boolean };
      const filter = filters.update(id, b);
      if (!filter) throw new ApiError(404, 'NOT_FOUND', 'Filter not found');
      return { filter };
    },
  );

  app.delete('/api/admin/filters/:id', { preHandler: [hooks.requireAuth, hooks.requireCsrf] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const deleted = filters.delete(id);
    if (!deleted) throw new ApiError(404, 'NOT_FOUND', 'Filter not found');
    return reply.code(204).send();
  });
```

- [ ] **Step 2: Add the failing tests (append a new describe block to admin-filters.test.ts)**

Append to `packages/api-server/test/admin-filters.test.ts`:
```ts
describe('PATCH/DELETE /api/admin/filters', () => {
  it('edits a filter (display name, enabled) and bumps updated_at', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    const created = await t!.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'Before', categoryId } });
    const id = created.json().filter.id as string;
    const patched = await t!.app.inject({ method: 'PATCH', url: `/api/admin/filters/${id}`, headers: { cookie, ...csrf }, payload: { displayName: 'After', isEnabled: false } });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().filter.displayName).toBe('After');
    expect(patched.json().filter.isEnabled).toBe(false);
  });

  it('returns 404 when editing a missing filter', async () => {
    const { cookie, csrf } = await authedWithCategory();
    const res = await t!.app.inject({ method: 'PATCH', url: '/api/admin/filters/nope', headers: { cookie, ...csrf }, payload: { displayName: 'x' } });
    expect(res.statusCode).toBe(404);
  });

  it('deletes a filter (204) and then 404s on a second delete', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    const created = await t!.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'F', categoryId } });
    const id = created.json().filter.id as string;
    const del = await t!.app.inject({ method: 'DELETE', url: `/api/admin/filters/${id}`, headers: { cookie, ...csrf } });
    expect(del.statusCode).toBe(204);
    const again = await t!.app.inject({ method: 'DELETE', url: `/api/admin/filters/${id}`, headers: { cookie, ...csrf } });
    expect(again.statusCode).toBe(404);
  });

  it('requires CSRF to delete (403 without token)', async () => {
    const { cookie, csrf, categoryId } = await authedWithCategory();
    const created = await t!.app.inject({ method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf }, payload: { ncpBase64: ncpBase64(), displayName: 'F', categoryId } });
    const id = created.json().filter.id as string;
    const res = await t!.app.inject({ method: 'DELETE', url: `/api/admin/filters/${id}`, headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 3: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test admin-filters`
Expected: PASS (11 tests total in this file).

- [ ] **Step 4: Commit**

```bash
git add packages/api-server/src/routes/admin-filters.ts packages/api-server/test/admin-filters.test.ts
git commit -m "feat(api-server): add filter edit and delete routes"
```

---

## Task 11: Public filter API with ETag

**Files:**
- Create: `packages/api-server/src/routes/public-filters.ts`
- Modify: `packages/api-server/src/app.ts` (register public routes)
- Test: `packages/api-server/test/public-filters.test.ts`

**Interfaces:**
- Consumes: `AppContext`, `FilterRepository.listEnabled` (returns filters with nested category, only enabled filters in enabled categories).
- Produces: `GET /api/filters` → `{ categories: [{ id, name, slug, sortOrder, filters: [ { id, slug, displayName, sourceName, description, parserVersion, parsed } ] }] }`, an `ETag` header, and `304` when `If-None-Match` matches. No auth. Does NOT expose the raw blob.

- [ ] **Step 1: Write public-filters.ts**

```ts
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { AppContext } from '../app';

interface PublicFilter {
  id: string;
  slug: string;
  displayName: string;
  sourceName: string;
  description: string;
  parserVersion: number;
  parsed: unknown;
}
interface PublicCategory {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  filters: PublicFilter[];
}

export function registerPublicFilterRoutes(app: FastifyInstance, ctx: AppContext): void {
  const filters = ctx.db.repos.filters;

  app.get('/api/filters', async (req, reply) => {
    const rows = filters.listEnabled();
    const byCat = new Map<string, PublicCategory>();
    for (const r of rows) {
      let cat = byCat.get(r.category.id);
      if (!cat) {
        cat = { id: r.category.id, name: r.category.name, slug: r.category.slug, sortOrder: r.category.sortOrder, filters: [] };
        byCat.set(r.category.id, cat);
      }
      cat.filters.push({
        id: r.id,
        slug: r.slug,
        displayName: r.displayName,
        sourceName: r.sourceName,
        description: r.description,
        parserVersion: r.parserVersion,
        parsed: JSON.parse(r.parsedJson),
      });
    }
    const categories = [...byCat.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    const body = { categories };

    const etag = `"${createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32)}"`;
    reply.header('etag', etag);
    reply.header('cache-control', 'private, max-age=60');
    if (req.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    return body;
  });
}
```

- [ ] **Step 2: Wire into app.ts**

In `src/app.ts`, add the import:
```ts
import { registerPublicFilterRoutes } from './routes/public-filters';
```
And inside `buildApp`, after the `registerAdminFilterRoutes(app, ctx, hooks);` line, add:
```ts
  registerPublicFilterRoutes(app, ctx);
```
This is the final route registration; `buildApp` is now complete.

- [ ] **Step 3: Write the failing test**

`packages/api-server/test/public-filters.test.ts`:
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildTestApp, login, type TestApp } from './helpers/build-test-app';

const here = dirname(fileURLToPath(import.meta.url));
const ncpBase64 = () => readFileSync(join(here, '../../ncp-parser/test/fixtures/PICCON02.NCP')).toString('base64');

let t: TestApp | null = null;
afterEach(async () => {
  await t?.app.close();
  t = null;
});

async function publishEnabledFilter(enabled = true) {
  t = await buildTestApp();
  const { cookie, csrfToken } = await login(t.app);
  const csrf = { 'x-csrf-token': csrfToken };
  const cat = await t.app.inject({ method: 'POST', url: '/api/admin/categories', headers: { cookie, ...csrf }, payload: { name: 'Film' } });
  const categoryId = cat.json().category.id as string;
  await t.app.inject({
    method: 'POST', url: '/api/admin/filters', headers: { cookie, ...csrf },
    payload: { ncpBase64: ncpBase64(), displayName: 'Fuji Astia', categoryId, isEnabled: enabled },
  });
  return { categoryId };
}

describe('GET /api/filters (public)', () => {
  it('returns enabled filters grouped by category with parsed params, no blob', async () => {
    await publishEnabledFilter(true);
    const res = await t!.app.inject({ method: 'GET', url: '/api/filters' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.categories).toHaveLength(1);
    expect(body.categories[0].name).toBe('Film');
    expect(body.categories[0].filters).toHaveLength(1);
    const f = body.categories[0].filters[0];
    expect(f.displayName).toBe('Fuji Astia');
    expect(f.parsed.sourceName).toBe('Fuji Astia');
    expect(f).not.toHaveProperty('ncpBlob');
    expect(res.body).not.toContain('ncpBlob');
  });

  it('excludes disabled filters', async () => {
    await publishEnabledFilter(false);
    const res = await t!.app.inject({ method: 'GET', url: '/api/filters' });
    expect(res.json().categories).toHaveLength(0);
  });

  it('sends an ETag and returns 304 when If-None-Match matches', async () => {
    await publishEnabledFilter(true);
    const first = await t!.app.inject({ method: 'GET', url: '/api/filters' });
    const etag = first.headers['etag'];
    expect(etag).toBeTruthy();
    const second = await t!.app.inject({ method: 'GET', url: '/api/filters', headers: { 'if-none-match': String(etag) } });
    expect(second.statusCode).toBe(304);
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test public-filters`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api-server/src/routes/public-filters.ts packages/api-server/src/app.ts \
  packages/api-server/test/public-filters.test.ts
git commit -m "feat(api-server): add public filter API with ETag caching"
```

---

## Task 12: Server bootstrap, exports, build, and final verification

**Files:**
- Create: `packages/api-server/src/start.ts`
- Modify: `packages/api-server/src/index.ts` (public exports)
- Verify: `tsup.config.ts`, `package.json` (from Task 0)

**Interfaces:**
- Produces: `start.ts` (load config → initDb → seedInitialAdmin → buildApp → listen on 127.0.0.1:PORT); the package's public exports; a consumable ESM build (`dist/index.js`, `dist/index.d.ts`, `dist/start.js`).

- [ ] **Step 1: Write start.ts**

```ts
import { loadConfig } from './config';
import { initDb } from './db';
import { buildApp } from './app';
import { SessionService } from './auth/session';
import { seedInitialAdmin } from './seed';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = initDb(config.dbPath);
  await seedInitialAdmin(config, db.repos);
  const sessions = new SessionService(config, db.repos);
  const app = await buildApp({ config, db, sessions });
  // Listen on the local interface only; Nginx proxies /api in production (spec §14).
  await app.listen({ port: config.port, host: '127.0.0.1' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Write the public exports in index.ts (replacing the stub)**

`packages/api-server/src/index.ts`:
```ts
export { buildApp, type AppContext } from './app';
export { loadConfig, type AppConfig } from './config';
export { initDb, type AppDb, type Repos } from './db';
export { SessionService, type CreatedSession } from './auth/session';
export { seedInitialAdmin } from './seed';
export { ApiError, type ApiErrorCode } from './errors';
export { hashPassword, verifyPassword } from './auth/password';
```

- [ ] **Step 3: Typecheck**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server typecheck`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server build`
Expected: tsup emits `dist/index.js`, `dist/index.d.ts`, `dist/start.js` (+ sourcemaps). Workspace deps and Fastify plugins are external (not bundled).

- [ ] **Step 5: Smoke-test the built library as a consumer**

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && cd packages/api-server && node --input-type=module -e "import { buildApp, loadConfig, initDb, SessionService } from './dist/index.js'; console.log(typeof buildApp, typeof loadConfig, typeof initDb, typeof SessionService);"
```
Expected: `function function function function`. (Run from inside `packages/api-server` so workspace deps resolve.)

- [ ] **Step 6: Run the full suite and confirm dist is ignored**

```bash
export PATH="$HOME/.nvm/versions/node/v22.20.0/bin:$PATH" && pnpm --filter @easypic/api-server test
git status --short   # nothing under packages/api-server/dist
```
Expected: all api-server tests pass; `git status` shows nothing under `packages/api-server/dist`.

- [ ] **Step 7: Milestone commit**

```bash
git add packages/api-server/src/start.ts packages/api-server/src/index.ts
git commit -m "chore(api-server): v0.1.0 API server complete (public + admin API, auth, NCP upload)"
```

---

## Out of scope for this plan

The browser image pipeline and preview/export (spec §10) → **image-engine**. The React user app (§3.1, §4) → **web-app**. The React admin UI (§3.2) → **admin-app**. Nginx/PM2/HTTPS deployment and automated backups (§14) are operations concerns handled at deploy time; this plan provides the migration command (inherited), the health endpoint, and the local-listen bootstrap they build on.
