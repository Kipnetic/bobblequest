# ONBOARDING.md

## What this file is for

A quick-start ramp for new contributors. The full onboarding guide lives at
[`docs/onboarding.md`](docs/onboarding.md) — start here, then follow the links.

## When to update it

- The toolchain, stack, or access model changes
- Day 1 steps change (new clone target, new env setup, new PR process)
- Week 1 or Week 2 expectations shift
- A key owner changes and the "Who to ask" table needs updating

---

## What is this repo?

This repo is an **internal scaffold for new projects** at the organization. The goal: clone it,
fill in the placeholders, and have a production-grade full-stack product ready to extend on day one.
Everything in the repo is functional — not a skeleton.

The tech stack is: **Bun 1.4.2** (runtime, package manager, bundler) + **Turborepo** (monorepo
task pipeline) + **TypeScript** (strict mode everywhere) + **Clerk** (auth across all surfaces) +
**RevenueCat** (primary billing layer for web, mobile, and desktop) over **Stripe** (web payment
processor behind RevenueCat) + **PostHog** (analytics, feature flags, session replay, LLM
observability) + **Drizzle ORM + Postgres** (type-safe schema, generated migrations) + **Railway**
(PaaS deploys, auto-deploy on push) + **tRPC AppRouter** (type-safe internal API). The monorepo
contains five client apps: `api` (tRPC + Hono), `web` (Next.js product UI), `website` (Next.js
marketing), `mobile` (Expo + React Native), and `desktop` (Electron).

---

## Day 1

> Full steps with screenshots and troubleshooting:
> [`docs/onboarding.md#day-1`](docs/onboarding.md#day-1)

1. Clone the repo and enter the directory.
2. Run `bun install` to install all workspace dependencies.
3. Copy every `.env.example` file to `.env` in the same directory and fill in the required values.
   At minimum: root `.env.example`, `apps/api/.env.example`, `apps/web/.env.example`.
4. Run `bun run doctor` to verify your local environment is wired correctly.
5. Run `bun run dev` to boot all apps via Turbo.
6. Confirm the API is alive: `curl http://localhost:3000/health` should return `200 OK`.
7. Read `README.md` for a project overview, then `docs/index.md` for the docs tree map.

---

## Week 1

1. Read `CONVENTIONS.md` end-to-end — it governs layer boundaries, type safety, naming, error
   handling, testing, and logging for all code written in this repo.
2. Walk one complete platform-package phase trail to understand how a package is structured:
   read `docs/architecture/platform/analytics/phase-01.md` through `phase-08.md` in order.
3. Open a "good first PR": fix a typo in a doc or README. This confirms your git access,
   Lefthook hooks, commitlint, and CI are all wired correctly end-to-end.
4. Run a Drizzle migration locally:
   `bun run --filter @t/db db:migrate` — then inspect the result in your local Postgres instance.
5. Push the "good first PR" branch and watch the CI pipeline (lint, typecheck, test) complete in
   GitHub Actions.

---

## Week 2

1. Write your first tRPC procedure end-to-end, following the tutorial at
   [`docs/tutorials/add-a-trpc-procedure.md`](docs/tutorials/add-a-trpc-procedure.md).
2. Add a runbook for a failure mode you've encountered or can imagine. Drop it in
   `docs/runbooks/` following the existing format.
3. Attend an ADR review (or read the two most recent ADRs in `docs/adr/` and leave async
   comments). Understanding the "why" behind design decisions is as important as the "what".

---

## Where to find things

| What | Where |
| --- | --- |
| Source code | `apps/`, `packages/` |
| Docs hub | `docs/index.md` |
| ADRs | `docs/adr/` |
| Runbooks | `docs/runbooks/` |
| Env vars reference | `docs/reference/env-vars.md` |
| PRD status | `docs/prd-status/` |
| CI workflows | `.github/workflows/` |
| Railway config | `railway.toml` |

---

## Who to ask

| Topic | Owner |
| --- | --- |
| Backend (API, tRPC, Drizzle, auth) | `<TBD>` |
| Frontend (web, website, mobile, desktop) | `<TBD>` |
| Infrastructure (Railway, CI/CD, Docker) | `<TBD>` |
| Security vulnerabilities | `<TBD>` |
| Billing (RevenueCat, Stripe) | `<TBD>` |
| Analytics (PostHog) | `<TBD>` |

---

**Last reviewed:** 2026-04-28 — owner: TBD
