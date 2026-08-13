# Repository Guidelines

## Project Structure & Module Organization

EasyPic is a pnpm TypeScript monorepo. Workspace packages live under `packages/`: `web-app` and `admin-app` are React/Vite clients, `api-server` is the Fastify service, `database` owns SQLite access and migrations, `image-engine` handles rendering, and `ncp-parser` parses Nikon picture-control files. Production code belongs in each package's `src/`. Unit tests live in `test/` or `src/test/`; Playwright suites use `e2e/` or `test/browser/`. Keep reusable fixtures and helpers beside the tests that consume them. Repository scripts are in `scripts/`, while implementation specs and plans are under `docs/superpowers/`.

## Build, Test, and Development Commands

- `pnpm install` installs the pinned pnpm workspace dependencies (Node `>=20.19 <21` or `>=22.12`).
- `cp .env.local.example .env.local && pnpm dev` builds internal libraries and starts the API, public app, and admin app on ports 3000, 5173, and 5174.
- `pnpm test` runs every package's Vitest suite; `pnpm test:dev-script` validates the local launcher.
- `pnpm -r build` builds all packages, and `pnpm -r typecheck` runs strict TypeScript checks.
- `pnpm --filter @easypic/web-app test:e2e` runs one package's Playwright suite. Replace the filter to target another package or command.

## Coding Style & Naming Conventions

Use ESM TypeScript with two-space indentation, semicolons, single quotes, and trailing commas where existing files do. Keep filenames kebab-case (`worker-client.ts`, `export-dialog.tsx`), React components and exported types PascalCase, and variables/functions camelCase. Prefer type-only imports and explicit types at package boundaries. No repository-wide formatter or linter is configured, so match nearby code and run `pnpm -r typecheck` before submitting.

## Testing Guidelines

Vitest is the unit/integration runner; React tests use Testing Library and MSW, while browser workflows use Playwright. Name unit tests `*.test.ts` or `*.test.tsx` and browser tests `*.spec.ts`. Add a regression test for every behavior change, using package-local helpers and fixtures. There is no numeric coverage threshold; cover success, validation, and failure paths affected by the change.

## Commit & Pull Request Guidelines

Follow the established Conventional Commit pattern: `feat(web-app): ...`, `fix(api-server): ...`, `test(admin-app): ...`, or `docs(scope): ...`. Keep subjects imperative and package-scoped. Pull requests should explain the user-visible change, list verification commands, link relevant issues/specs, and include screenshots for UI changes. Call out database migrations, new environment variables, or deployment changes explicitly. Never commit `.env.local`, secrets, or local SQLite data.
