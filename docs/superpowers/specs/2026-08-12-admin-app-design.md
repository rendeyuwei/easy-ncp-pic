# EasyPic Admin App Design

**Date:** 2026-08-12  
**Status:** Approved for implementation planning  
**Parent specification:** `docs/superpowers/specs/2026-07-14-easy-pic-design.md`

## 1. Goal

Build the first EasyPic administration application for the single configured administrator. The application must support authentication, category management, and the complete lifecycle of NCP filters: local inspection, creation, metadata editing, enabling or disabling, sorting, and deletion.

This design refines the parent specification without changing its privacy or trust boundaries. The public editor remains independent of administrator credentials. User photos remain browser-local. The administration application calls protected HTTP APIs and never accesses SQLite or the server filesystem directly.

## 2. Scope

The milestone includes:

- A standalone React application in `packages/admin-app`, served under `/admin`.
- Login, logout, authenticated-session restoration, and protected navigation.
- Filter listing, NCP upload and preview, creation, metadata editing, status changes, sorting, and deletion.
- Category listing, creation, editing, status changes, sorting, and deletion.
- Responsive, keyboard-accessible loading, empty, error, form, dialog, and confirmation states.
- One additive API endpoint, `GET /api/admin/session`, for restoring the CSRF token associated with an existing authenticated cookie session.
- API integration, unit, component, and browser tests for the critical administration paths.

The milestone intentionally excludes:

- Replacing the NCP binary of an existing filter.
- Drag-and-drop ordering; administrators edit integer sort-order values.
- Bulk actions, analytics, audit logs, multiple administrators, roles, or permissions.
- Automatic third-party filter discovery or download.
- A generic schema-driven CRUD framework.

## 3. Chosen Approach

EasyPic will use a route-oriented administration SPA rather than a single crowded dashboard or a generalized CRUD generator.

The alternatives were rejected for the first milestone:

- A single-page dashboard reduces initial routing work but tangles independent list, dialog, and mutation states and scales poorly.
- A schema-generated CRUD system adds abstraction cost while the NCP upload and preview workflow still requires substantial special handling.

The chosen application has explicit route, API, session, form, and NCP-preview boundaries. Each unit can be tested independently and extended without coupling the public editor to administration behavior.

## 4. Architecture

### 4.1 Package and runtime

`packages/admin-app` is a private Vite 8, React 19, strict TypeScript package. It uses:

- TanStack Router for route ownership and authenticated navigation.
- TanStack Query for server state, mutations, cache invalidation, and retry boundaries.
- Local shadcn/ui-style components backed by focused Radix primitives where accessibility behavior is nontrivial.
- `@easypic/ncp-parser` directly in the browser for untrusted local preview.
- Vitest, Testing Library, MSW, and Playwright for verification.

The package may share visual conventions with `web-app`, but it does not import public-editor components or state. Common code is extracted only when a real shared abstraction exists; this milestone does not create a speculative UI package.

Development proxies `/api` to the existing Fastify server. Vite uses `/admin/` as its asset base and TanStack Router uses `/admin` as its base path. Production serves the built application at `/admin`, rewrites unknown `/admin/*` navigation requests to the administration `index.html`, and routes `/api` to Fastify. Browser requests use same-origin cookies.

### 4.2 Routes

- `/admin` redirects authenticated users to `/admin/filters` and unauthenticated users to `/admin/login`.
- `/admin/login` renders the login form. An authenticated visit redirects to `/admin/filters`.
- `/admin/filters` owns filter listing and filter dialogs.
- `/admin/categories` owns category listing and category dialogs.
- Unknown paths below `/admin` redirect according to authentication state.

The root session bootstrap completes before protected content is shown. A neutral application-loading state prevents a protected page or login form from flashing while the cookie session is being checked.

### 4.3 Component boundaries

- **Session provider:** bootstraps, logs in, logs out, stores the in-memory CSRF token, and exposes a small authentication state machine.
- **API client:** sends JSON requests, includes same-origin credentials, adds the CSRF header to mutations, validates expected response shapes, and converts API errors into typed failures.
- **Admin shell:** owns responsive navigation, page title, mobile menu, and logout action; it does not own page data.
- **Theme controller:** applies the shared dark/light design tokens, follows the system preference before an explicit choice, and persists only the appearance preference.
- **Filter page:** queries filter/category data and coordinates create, edit, and delete dialogs.
- **NCP inspector:** reads the chosen file, enforces the client size limit, invokes the parser, and returns a typed preview result independent of form submission.
- **Category page:** queries categories and coordinates create, edit, and delete dialogs.
- **Form/dialog primitives:** provide labeled fields, field errors, pending-state protection, focus management, and destructive confirmation.

## 5. Authentication and Session Restoration

### 5.1 Session API extension

Add this endpoint to the existing authentication routes:

```http
GET /api/admin/session
Cookie: sid=<http-only token>

200 OK
{ "csrfToken": "..." }
```

The endpoint uses the existing `requireAuth` hook. It returns the `csrfSecret` from the valid `req.session` as `csrfToken`. It does not rotate the session or cookie. Missing, expired, revoked, or invalid cookies use the existing `401 UNAUTHORIZED` response. The existing session-touch behavior applies.

Successful login and session-restoration responses set `Cache-Control: no-store` so a CSRF token is not retained by browser or intermediary caches.

This endpoint closes a current protocol gap: the cookie may survive a reload, but JavaScript intentionally cannot read it, and the existing login response is otherwise the only source of the CSRF token.

### 5.2 Client state machine

The session provider has four explicit states: `loading`, `authenticated`, `anonymous`, and `transitioning`.

1. On application mount, call `GET /api/admin/session`.
2. A successful response stores the CSRF token in memory and enters `authenticated`.
3. A `401` enters `anonymous`; it is an expected bootstrap result, not a global error toast.
4. Other bootstrap failures show a retryable connection state rather than pretending the user is logged out.
5. Login calls `POST /api/admin/session`, stores the returned token only in memory, and navigates to `/admin/filters`.
6. Logout calls `DELETE /api/admin/session` with the CSRF header. On success, clear the token, remove protected administration query data from memory, and navigate to login.

Passwords and CSRF tokens are never written to local storage, session storage, URLs, logs, or query caches. The session cookie remains `HttpOnly`, `SameSite=Lax`, and secure according to deployment configuration.

### 5.3 Authentication failures

- Any API `401` after bootstrap clears local session state and protected administration query data, then navigates to login. An unobtrusive message explains that the session expired.
- On a protected mutation, including logout, `403 CSRF_INVALID` makes the API layer perform one session-restoration request and retry the mutation once with the restored token. A second failure clears the local session and requires login.
- The retry is limited to one attempt. Login and the restoration request itself never enter this path.
- The API client prevents concurrent restoration requests from creating a request stampede; callers share one in-flight restoration promise.

### 5.4 Management API consistency

The administration UI requires conflicts to remain recoverable, so the affected API routes receive focused constraint mapping rather than leaking SQLite failures as `500` responses:

- Add `SLUG_CONFLICT` to the API error-code union.
- Category create/update maps a duplicate slug to `409 SLUG_CONFLICT`.
- Filter create/update maps a duplicate slug to `409 SLUG_CONFLICT`; duplicate NCP bytes continue to use `409 DUPLICATE_NCP`.
- Filter create/update maps a missing category reference to `400 VALIDATION_ERROR` with a `categoryId` field error.
- Category names and filter display names are trimmed and must contain `1..100` characters. Descriptions are trimmed and limited to `500` characters. A supplied slug is trimmed, limited to `60` characters, and must match lowercase ASCII segments separated by single hyphens (`[a-z0-9]+(?:-[a-z0-9]+)*`). On create, a blank slug is omitted so the repository derives one. Edit forms start with the current slug; if an update includes `slug`, it must be nonempty and valid. Changing a name never silently changes an existing slug. Sort order must be an integer.
- The Fastify request schemas enforce these bounds, create routes enforce their required fields, and patch routes require at least one editable field. The browser mirrors the same rules for immediate feedback, but the server remains authoritative.

This is limited to constraints exercised by the administration forms and does not introduce a general persistence abstraction.

## 6. Application Shell and Responsive Behavior

The administration interface is a practical workspace rather than a visual copy of the photo editor. It uses the same EasyPic identity and design tokens but prioritizes dense, legible operational data.

- Desktop presents a persistent side navigation with “滤镜”, “分类”, and “退出登录”.
- Narrow screens replace the side navigation with a labeled menu trigger and overlay navigation.
- The default appearance follows the system preference, falling back to the dark EasyPic workspace. A labeled theme control switches between dark and light modes and stores only that choice in local storage.
- Desktop list views use tables. Narrow screens render equivalent cards without hiding required actions or status.
- Destructive actions require confirmation. Create and edit operations use dialogs with managed initial focus and focus restoration.
- Keyboard focus is always visible. Controls have accessible names, dialogs have titles/descriptions, status is not conveyed by color alone, and reduced-motion preferences disable nonessential transitions.
- A global notification region reports successful mutations and page-level failures without replacing field-specific feedback.
- React Bits is not included in the administration milestone. Its optional motion does not improve the critical authentication or CRUD paths, and standard CSS transitions already satisfy the approved interaction scope.

## 7. Filter Management

### 7.1 Filter list

`GET /api/admin/filters` supplies the complete filter collection, including disabled filters. The list displays:

- Display name and NCP source name.
- Category name, resolved from the category query by `categoryId`.
- Enabled or disabled status.
- Integer sort order.
- Last-updated time.
- Edit and delete actions.

The page has explicit loading, empty, error, and retry states. A missing category reference is rendered as “未知分类” rather than crashing the list. The default server order is preserved; this milestone does not add client-side reordering.

### 7.2 NCP selection and browser preview

Creation begins with one `.ncp` file. The inspector:

1. Rejects an empty file or a file larger than 64 KiB before parsing as an early abuse guard. The current supported NCP 1.00 layout is exactly 638 bytes; any other length is rejected by `ncp-parser`.
2. Reads the file into a `Uint8Array` without network access.
3. Calls `parseNcp` from `@easypic/ncp-parser`.
4. Distinguishes parser failures from structurally valid but unsupported variants.
5. Displays source name, NCP source version, parser schema version, base mode, enabled adjustment values, curve control-point count, LUT size, monochrome settings when applicable, and parser warnings.
6. Allows submission only when parsing succeeds and `supported === true`.

The preview explains that the server will validate the binary again. It does not attempt to render a photo preview because that would add an unrelated image-selection workflow to an administrative metadata task.

The chosen file remains local until the administrator presses save. Selecting another file replaces the inspector result and derived defaults. Closing the dialog clears the binary and preview from component state.

### 7.3 Create form

After a supported preview exists, the form collects:

- Display name, initially populated from the parsed source name and required.
- Category, required and selected from current categories.
- Description, optional.
- Slug, optional; the server may derive it when omitted.
- Sort order, integer with default `0`.
- Enabled status, default `true`.

At least one category must exist before a filter can be created. If none exists, the dialog provides a clear link to category management rather than an unusable category field.

On submission, the browser converts the original bytes to Base64 and sends the existing `POST /api/admin/filters` JSON contract. Encoding must avoid argument spreading over the byte array. The route's 64 KiB `bodyLimit` applies to the complete serialized JSON request, not raw-file length; a Base64-encoded 638-byte supported NCP plus the bounded metadata fields remains safely below that limit. The server remains authoritative: it decodes, parses, checks support, computes SHA-256, detects duplicates, and persists its own parsed JSON. Client parser output is never sent as trusted parsed data.

### 7.4 Edit and delete

The edit dialog changes only display name, description, category, slug, integer sort order, and enabled status through `PATCH /api/admin/filters/:id`. It shows the saved `parsedJson` details read-only after safe JSON parsing. Invalid historical JSON produces an unavailable-details message while metadata editing remains usable.

Replacing the NCP binary is excluded. Administrators create a new record when a different binary is required.

Delete opens a destructive confirmation naming the filter and calls `DELETE /api/admin/filters/:id`. Success closes the confirmation and removes stale list data through query invalidation. Failure keeps the dialog and context available for retry.

## 8. Category Management

The category list uses `GET /api/admin/categories` and displays name, slug, enabled status, and integer sort order. Create and edit dialogs collect the same fields; name is required, slug is optional, sort order defaults to `0`, and enabled defaults to `true`.

Create calls `POST /api/admin/categories`; edit calls `PATCH /api/admin/categories/:id`. Delete requires a named confirmation and calls `DELETE /api/admin/categories/:id`.

If the server returns `409 CATEGORY_IN_USE`, the dialog stays open and explains that filters must be moved or removed before the category can be deleted. The UI does not guess usage from cached filters because the server owns referential integrity.

Every successful category mutation invalidates both category and filter queries. Category names appear in the filter list, and category validity affects the create-filter form, so unconditional invalidation is simpler and deterministic.

## 9. API Data and Cache Rules

The client validates every response field it consumes instead of blindly casting JSON. Validation failures become retryable application errors, not partial rendering failures.

Suggested query keys are:

- `['admin-filters']` for the full filter list.
- `['admin-categories']` for the category list.

Session bootstrap and CSRF restoration use the session provider's single-flight request, not the TanStack Query cache, so the token cannot be retained as ordinary query data.

Queries retry transient network and `5xx` failures once. They do not retry `4xx` responses. Mutations are not automatically repeated except for the single controlled CSRF restoration path. Submit buttons stay disabled while their mutation is pending so double activation cannot create duplicate records.

Form values remain mounted after network, server-validation, conflict, or CSRF-recovery failures. Successful create/edit/delete actions close their dialog, invalidate affected queries, and report success.

## 10. Error Mapping

The typed API error includes HTTP status, `code`, message, and optional field errors. The UI maps known codes as follows:

- `INVALID_CREDENTIALS`: show one generic username/password error without revealing which value was wrong.
- `UNAUTHORIZED`: clear local authentication and return to login.
- `CSRF_INVALID`: restore and retry once as specified above.
- `VALIDATION_ERROR`: attach returned field errors to matching controls; unmatched errors appear in the form summary.
- `PAYLOAD_TOO_LARGE`: explain that the complete upload request exceeded 64 KiB and that the currently supported NCP file itself is 638 bytes.
- `INVALID_NCP`: explain that the file is empty, damaged, or not a valid supported-layout NCP; include a safe parser code when the server supplies one.
- `UNSUPPORTED_NCP`: explain that the NCP variant is structurally recognized but cannot be published.
- `DUPLICATE_NCP`: preserve the form and show the server conflict message.
- `SLUG_CONFLICT`: attach the conflict to the slug field and preserve all form values.
- `CATEGORY_IN_USE`: preserve the delete confirmation and explain the required remediation.
- `RATE_LIMITED`: show a retry-later message and keep entered values.
- Unknown or `INTERNAL` errors: show a generic retryable failure without stack traces or raw HTML.

Client-only NCP errors use the same conceptual categories but never replace server verification. Network failures preserve the active form and offer retry. All displayed server text is rendered as text, not HTML.

## 11. Testing Strategy

### 11.1 API integration tests

Extend the current Fastify tests to verify:

- A valid login cookie can call `GET /api/admin/session` and receive its matching CSRF token.
- Missing, expired, and revoked sessions receive `401 UNAUTHORIZED`.
- Session restoration touches valid sessions without rotating the cookie or creating a new database session.
- The restored token authorizes a protected mutation, while an invalid token still receives `403 CSRF_INVALID`.
- Login and restoration responses use `Cache-Control: no-store`.
- Duplicate category/filter slugs and invalid filter categories produce the specified typed `409`/`400` responses for both create and update paths.

Existing login, logout, filter, category, NCP parsing, duplicate detection, and payload-limit suites remain regression coverage.

### 11.2 Unit tests

Cover:

- Runtime API response validation and typed error mapping.
- Single-flight session restoration and the one-retry CSRF rule.
- File-size checks, binary reading, parser error classification, and preview-summary derivation.
- Chunk-safe Base64 conversion and preservation of the original bytes.
- Safe decoding of persisted `parsedJson` details.
- System/default theme resolution and persisted dark/light preference without storing authentication material.

### 11.3 Component tests

Use Testing Library and MSW to verify:

- Bootstrap loading, anonymous login, authentication errors, successful navigation, logout, and route guards.
- Filter loading/empty/error states, supported and unsupported NCP selection, form defaults, field errors, conflicts, metadata editing, status changes, and confirmed deletion.
- Category create/edit/status/delete paths and the in-use conflict.
- Theme switching, pending-state double-submit prevention, focus restoration, keyboard access, and responsive-equivalent action availability.

### 11.4 Browser tests

Playwright covers the critical workflow against the real Fastify application with a temporary SQLite database and deterministic seeded administrator. This preserves real cookie, CSRF, constraint, and NCP validation behavior while keeping tests isolated:

1. Log in.
2. Create a category.
3. Upload and inspect a known supported NCP fixture.
4. Create, edit, disable/enable, and delete a filter.
5. Verify category deletion conflict while referenced, then delete after the filter is removed.
6. Reload a protected route and confirm cookie-session restoration without another login.
7. Verify desktop and mobile navigation reach both management pages.
8. Switch theme and confirm the preference survives reload independently of authentication state.

Before completion, run admin-app type checking, unit/component tests, production build, browser tests, affected API tests, and the repository-wide test command.

## 12. Acceptance Criteria

The milestone is complete when:

- An anonymous visitor cannot view or mutate protected administration data.
- A valid existing cookie session survives a page reload without persisting secrets in browser storage.
- The administrator can create and manage categories with clear referential-integrity feedback.
- A supported NCP is inspected locally, submitted once, revalidated by the server, and shown in the complete filter list.
- Invalid, oversized, unsupported, and duplicate NCP inputs cannot create a filter and produce actionable messages.
- Filter metadata, category, sort order, and enabled state can be edited; deletion requires confirmation.
- Responsive desktop/mobile interfaces expose equivalent critical functionality and remain keyboard accessible.
- Dark/light appearance follows and persists user preference without adding optional animation dependencies.
- Errors preserve recoverable user input and do not leak credentials, tokens, stack traces, or trusted HTML.
- All specified verification suites pass from a clean checkout with the committed lockfile.
