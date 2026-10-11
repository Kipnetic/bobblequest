# Onboarding (full)

## What this file is for

The complete ramp guide for new contributors. Root `ONBOARDING.md` is the abbreviated version —
this file is the authoritative, long-form reference. Covers Day 1 setup through your first real
PR, plus tooling cheat sheets and a stack provider quick reference.

## When to update it

- Toolchain or stack changes (new runtime version, new service provider, new CLI)
- Day 1 steps change: clone target, env setup, verify command, port numbers
- Week 1 or Week 2 expectations shift
- A key owner changes and the "Who to ask" table needs updating
- A new doc section is added that new contributors should read

---

## Day 1: get the repo running

### Prerequisites

| Requirement | Version | Install |
| --- | --- | --- |
| macOS / Linux / Windows (WSL 2) | — | — |
| Bun | 1.4.2+ | `curl -fsSL https://bun.sh/install \| bash` |
| Docker Desktop | latest stable | <https://www.docker.com/products/docker-desktop> |
| Node.js | 20+ | <https://nodejs.org> (tooling parity only; Bun is the runtime) |
| Git | latest stable | pre-installed on most systems |

Bun is the runtime, package manager, bundler, and test runner. Node is only required for a small
number of tools that have not yet been ported to Bun.

### Clone and bootstrap

```bash
git clone <REPO-URL>
cd <REPO-NAME>
bun install
```

Lefthook (git hooks) auto-installs via the `prepare` lifecycle script on `bun install`. You do not
need to run `lefthook install` manually.

### Configure environment

Each app has its own `.env.example`. Copy each one to `.env` in the same directory and fill in the
required values:

```bash
cp apps/api/.env.example       apps/api/.env
cp apps/web/.env.example       apps/web/.env
cp apps/website/.env.example   apps/website/.env
cp apps/mobile/.env.example    apps/mobile/.env
cp apps/desktop/.env.example   apps/desktop/.env
cp packages/db/.env.example    packages/db/.env
```

Reference: `docs/reference/env-vars.md` — all variables, their types, and which are required vs
optional at boot. Config schemas throw at boot for missing required vars; there are no silent
no-op fallbacks.

### Run the dev stack

One command boots the full stack — Docker (Postgres + Redis + api/web/website containers),
Drizzle migrations, mobile (Expo), desktop (Electron), readiness polling, and browser auto-open:

```bash
bun run dev          # alias: bun run up
```

Useful flags (forward via `bun run dev -- <flag>`):

| Flag | Purpose |
| --- | --- |
| `--no-docker` | Skip docker compose + migrations (host-only iteration) |
| `--no-open` | Skip Phase 5.5 browser auto-open (set automatically when `CI=1`) |
| `--open=<csv>` | Limit auto-open to a subset, e.g. `--open=website,web` |
| `--no-mobile` / `--no-desktop` | Skip those host apps |
| `--quiet` | Suppress per-service log streaming |

For package iteration without Docker or auto-open:

```bash
bun run dev:packages
```

Ports:

| App | Port |
| --- | --- |
| API (tRPC + Hono) | 3000 |
| Web app (Next.js product UI) | 3001 |
| Website (Next.js marketing) | 3002 |
| Mobile (Metro bundler UI) | 8081 |
| Desktop (Electron) | — |

### Tear down the stack

Three escalating cleanup tiers — pick the lightest one that does the job:

| Command | What it does |
| --- | --- |
| `bun run stack:down` | Soft: stop host PIDs + `docker compose down --remove-orphans` + prune dangling layers. Named volumes preserved. |
| `bun run stack:clean` | `stack:down` + drop named volumes (`pgdata`, `redisdata`), build cache, and images labeled `com.template-repo.managed=true`. Scoped — never touches unrelated containers. |
| `bun run stack:nuke` | `stack:clean` + `docker system prune -af --volumes`. Wipes ALL Docker resources on the host. Pass `--force` to skip the confirm prompt (CI). |

### Verify env portability (same image, different runtime)

The website image reads `SITE_URL` at request time (not build time), so a single image hash hot-swaps
between staging and prod with no rebuild. Sanity check:

```bash
# build once
docker compose build website

# run with SITE_URL=staging.example.com — observe metadata
SITE_URL=https://staging.example.com docker compose up -d website
curl http://localhost:3002/api/health

# swap SITE_URL to prod, recreate container only (no rebuild)
SITE_URL=https://prod.example.com docker compose up -d --force-recreate --no-build website
curl http://localhost:3002/api/health
```

The image hash should be identical across both runs (`docker compose images website`). Required env
vars are validated at *first request* with a clear error, not at build time — see
`docs/reference/env-vars.md` for the full list of runtime-only vars.

### Verify the stack

```bash
bun run doctor
```

The doctor script checks each app's health endpoint, validates env var presence, and confirms
database connectivity. Expected output is a matrix of green checks — one row per app and service.
Any red row prints the failing check and a suggested fix.

Quick manual check: `curl http://localhost:3000/health` should return `200 OK`.

---

## Week 1: understand the architecture

### Read the conventions

Read `CONVENTIONS.md` end-to-end (Sections 1–14). It governs layer boundaries, type safety,
naming, error handling, testing, and logging for all code in this repo. It is not optional
background reading — it is the coding standard.

### Walk a platform-package phase trail

The analytics platform package documents its own construction across 8 phase files. Reading them
in order gives you the canonical mental model for how any platform package is structured:

```text
docs/architecture/platform/analytics/phase-01.md  ← start here
docs/architecture/platform/analytics/phase-02.md
...
docs/architecture/platform/analytics/phase-08.md  ← end here
```

This is the exemplar. Every other platform package follows the same shape.

### Read the ADRs

Open `docs/adr/README.md` for the full index. At minimum read:

- ADR 001 — platform split (why the monorepo is structured the way it is)
- ADR 003 — Bun + Turbo (why this toolchain over alternatives)
- ADR 005 — RevenueCat primary (why RevenueCat is the billing layer across all surfaces)

Understanding the "why" behind design decisions is as important as knowing the "what."

### Open a "good first PR"

Fix a typo or add a term to `docs/glossary.md`. This confirms:

- Git access is working
- Lefthook pre-commit hooks run (`bun run lint`, `bun run typecheck`)
- Commitlint validates your commit message format
- CI pipeline (lint, typecheck, test) passes in GitHub Actions

Push the branch and watch the Actions run before merging.

---

## Week 2: ship something real

### Add a tRPC procedure

Follow the tutorial at `docs/tutorials/add-a-trpc-procedure.md`. It walks you through the full
path: defining the procedure in the router, adding input/output Zod schemas, calling it from a
client, and writing the unit test.

### Add a runbook

Pick a failure mode you have encountered or can imagine. Copy `docs/runbooks/00-template.md` and
fill it in. A runbook needs: symptoms, severity, detection steps, mitigation steps, and a
resolution path. Drop the completed file in `docs/runbooks/`.

### Attend an ADR review

Join an ADR review session (or read the two most recent ADRs and leave async comments). The ADR
process is lightweight — any contributor can propose one. Understanding decisions already made
prevents you from relitigating them.

---

## Tooling cheat sheet

### Bun

```bash
bun install                    # install all workspace deps
bun add <pkg> --filter <app>   # add a dep to one app/package
bun run <script>               # run a root package.json script
bun run --filter <app> <script> # run a script in one workspace
bun test                       # run tests (falls through to vitest via turbo)
```

### Turbo

```bash
`bun run dev`     # full stack (Docker + migrations + all apps + auto-open) —
                  # see README "Quick start"
bun run dev:packages # turbo run dev — all apps in parallel, no Docker, no auto-open
bun build          # turbo run build
bun run typecheck  # turbo run typecheck
bun run check      # turbo run check (Biome lint + format)
bun run test       # turbo run test
bun run clean      # turbo run clean + rm node_modules
```

Turbo caches outputs. A task that has not changed since the last run returns instantly from cache.

### Lefthook

Lefthook runs pre-commit hooks automatically. The pre-commit stage runs Biome lint + typecheck on
staged files. If a hook fails, fix the reported issue — do not use `LEFTHOOK_EXCLUDE` or any
other mechanism to bypass it.

```bash
lefthook run pre-commit   # run hooks manually to check before committing
```

### Drizzle

```bash
bun run --filter @t/db db:generate   # generate migrations from schema changes
bun run --filter @t/db db:migrate    # apply pending migrations
bun run --filter @t/db db:studio     # open Drizzle Studio (visual schema browser)
bun run --filter @t/db db:seed       # seed local database
```

Schema source of truth: `packages/db/src/schema/`. Never edit generated migration files directly.

### Railway

```bash
railway up         # deploy current branch to Railway
railway logs       # stream logs from the deployed service
railway run <cmd>  # run a command in the Railway environment
```

Deploys are also triggered automatically on push to the main branch via GitHub Actions.

---

## Where to find things

| What | Where |
| --- | --- |
| Source code | `apps/`, `packages/` |
| Docs hub | `docs/index.md` |
| ADRs | `docs/adr/` |
| Runbooks | `docs/runbooks/` |
| Postmortems | `docs/postmortems/` |
| Env vars reference | `docs/reference/env-vars.md` |
| PRD status matrix | `docs/prd-status/matrix.md` |
| Platform package exemplar | `docs/architecture/platform/analytics/` |
| CI workflows | `.github/workflows/` |
| Railway config | `railway.toml` |
| Coding conventions | `CONVENTIONS.md` |
| Design decisions | `HANDOFF.md` (Design Decisions Locked section) |

---

## Who to ask

| Topic | Owner |
| --- | --- |
| Backend (API, tRPC, Drizzle, auth) | `<TBD>` |
| Frontend (web, website) | `<TBD>` |
| Mobile (Expo, React Native) | `<TBD>` |
| Desktop (Electron) | `<TBD>` |
| Infrastructure (Railway, CI/CD, Docker) | `<TBD>` |
| Security vulnerabilities | `<TBD>` |
| Billing (RevenueCat, Stripe) | `<TBD>` |
| Analytics (PostHog) | `<TBD>` |

---

## Stack provider quick reference

| Provider | What it does | Where keys live |
| --- | --- | --- |
| Clerk | Auth across all surfaces (web, mobile, desktop) | `CLERK_*` env vars |
| RevenueCat | Primary billing layer — entitlements, paywalls, server-side verification | `REVENUECAT_*` env vars |
| Stripe | Web payment processor (behind RevenueCat only — do not call Stripe directly from apps) | `STRIPE_*` env vars |
| PostHog | Product analytics, feature flags, session replay, LLM observability | `*_POSTHOG_*` env vars |
| Drizzle + Postgres | ORM + relational database | `DATABASE_URL` |
| Railway | PaaS deploy — auto-deploy on push to main | Railway dashboard |

---

**Last reviewed:** 2026-04-30 — owner: TBD
