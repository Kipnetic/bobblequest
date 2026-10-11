# template-repo Overview

**Applies to:** All files in this repo — orientation reference for stack, layout, commands, and documentation pointers.

## Documentation pointer
- All design / architecture / reference docs live in `docs/`.
  - `docs/architecture/` — intended architecture, ADRs, diagrams (source of truth for intent).
  - `docs/prd-status/` — live implementation status (source of truth for current state).
  - `docs/diagrams/`, `docs/artifacts/` — supporting visuals and generated artifacts.
- Update docs same-commit when touching related code (see live-docs rule).

## Stack (KV)
- Repo type: Bun + TypeScript monorepo, Bun workspaces + Turborepo
- Package manager: `bun@1.4.2` (do not use npm/pnpm/yarn)
- Build orchestrator: Turborepo `^2.0.0`
- Formatter + linter: Biome `^1.9.0` (config extends `packages/config/biome.json`)
- TypeScript: `^5.5.0` (base config: `tsconfig.base.json` → `packages/config/tsconfig/base.json`)
- Import alias: `@t/*` → `./packages/*/src` or `./packages/*`
- Test runner: Vitest (standard) — `bun:test` drift exists in some packages; verify per-workspace
- Architecture: Clean Architecture — `entities/` + `ports/` → `infrastructure/` → `dependency-injection/` (Awilix)
- Auth provider: Clerk
- Billing: RevenueCat (primary); Stripe only as web processor behind RevenueCat
- DB: Railway Postgres + pgvector + Drizzle ORM

## Apps (apps/*)
- `api` — Hono `^4.0.0` + tRPC
- `web` — Next.js `^15.0.0`
- `website` — Next.js `^15.0.0` + MDX
- `mobile` — Expo `~54.0.0`, React Native `0.76.0`, NativeWind `^4.1.0`
- `desktop` — Electron `^32.0.0` + electron-vite `^2.0.0` + React

## Packages (packages/*, all under `@t/*` scope)
- `analytics`, `auth`, `billing`, `cache`, `config`, `db`, `dependency-injection`, `errors`, `logging`

## Key commands
- Install: `bun install`
- Dev (all): `bun dev` (= `turbo run dev`)
- Dev (one app): `turbo run dev --filter=<app-name>`
- Build: `turbo run build` (or `bun build`)
- Test: `turbo run test` (or `bun test` — note this may invoke `bun:test` not Vitest; verify the runner per-workspace)
- Typecheck: `turbo run typecheck`
- Lint / check: `turbo run check` (Biome) — root script `lint` also maps to `turbo run check`
- Format: `turbo run format`
- Clean: `bun run clean` (= `turbo run clean && rm -rf node_modules`)
- Selective on PR: `turbo run <task> --filter=[origin/main...HEAD]`

## Bun config
- `bunfig.toml` — root install config: hoisted linker, text lockfile, Windows-tuned concurrency. See `.agents/rules/tooling/bun/` for invariants.

## Turbo pipeline (turbo.json)
- `build` depends on `^build`; outputs `.next/**` (no cache), `dist/**`
- `dev` is `persistent`, not cached
- `check`, `typecheck` depend on their `^` upstream
- `test` depends on `^build`; outputs `coverage/**`
- Global dep: `**/.env.*local`

## Status source of truth
- `docs/prd-status/README.md` — update same-commit when touching related code.
