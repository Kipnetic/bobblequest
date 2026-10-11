# Using this template

You just cloned `template-repo`. This file is your 30-minute orientation —
read it before customizing anything else.

For the deeper tutorial (boots the full stack, walks the request path
through tRPC), see `docs/tutorials/getting-started.md`. For the day-1 /
week-1 / week-2 ramp, see `ONBOARDING.md`.

## What you got

- **5 apps** in `apps/`:
  - `api` — Hono + tRPC backend (port 3000), Clerk JWT, DI composition root
  - `web` — Next.js 15 product UI (port 3001), Clerk OAuth
  - `website` — Next.js 15 + MDX marketing/blog (port 3002), no auth
  - `mobile` — Expo SDK 54 + React Native + NativeWind v4
  - `desktop` — Electron 32 + electron-vite
- **17 packages** in `packages/`: analytics (×4), auth, billing (×2), cache,
  config, db, dependency-injection, errors, logging (×4), queue. See
  `docs/packages/INDEX.md` for the full table with one-line purposes.
- **Tooling**: Bun 1.4.2 (single package manager — no pnpm, no npm),
  Turbo 2.9.6 (monorepo task runner), Lefthook (git hooks: format-check,
  lint, typecheck, test, secret-scan on pre-commit; commitlint on
  commit-msg), Drizzle (Postgres ORM), Docker Compose for local
  Postgres (pgvector pg17, port 5433), Redis (port 6380).
- **Engines**: Bun >= 1.4.2, Node >= 20.

## Five-minute first run

```bash
git clone {{REPO_URL}} {{PROJECT_DIR}}
cd {{PROJECT_DIR}}
bun install
cp .env.example .env                # fill in required vars (see below)
bun run dev                         # boots apps + Postgres + Redis
```

The full stack tutorial (with verifications, common errors, and the
request path through tRPC) lives in `docs/tutorials/getting-started.md`.

To check your local toolchain instead of booting the stack:

```bash
bun run doctor --fast
```

## Placeholder tokens to replace

The template uses three mustache-style tokens. Replace them globally
before your first commit:

| Token              | Where                       | Replace with                     |
| ------------------ | --------------------------- | -------------------------------- |
| `{{PROJECT_NAME}}` | `README.md` line 1          | Your product or project name     |
| `{{REPO_URL}}`     | `README.md` line 48         | Full git clone URL               |
| `{{PROJECT_DIR}}`  | `README.md` lines 49 and 92 | Local directory name after clone |

A grep covers the surface area:

```bash
grep -rn '{{' README.md USING_THIS_TEMPLATE.md docs/ apps/ packages/
```

## Customize before your first commit

1. **Rename the workspace.** Change `name` in root `package.json`
   (currently `template-repo`) to your project name.
2. **Update `README.md`.** Title, repo URL, and any team-specific framing.
3. **Replace `NOTICE.md`.** Current contents are template-internal.
4. **Decide which apps to keep.** Delete what you don't need:
   - `apps/desktop` — drop if you have no desktop product
   - `apps/mobile` — drop if you have no mobile product
   - `apps/website` — drop if your marketing lives elsewhere
   - `apps/api` and `apps/web` are the typical core
5. **Decide which packages to keep.** Each package is wired in via
   `packages/dependency-injection`. Common drops:
   - `@t/billing` + `@t/billing-browser` — if you don't monetize
   - `@t/queue` — if you don't run background jobs
   - `@t/analytics*` — if you handle analytics elsewhere
6. **Pick your auth provider.** Clerk is wired in by default. To swap,
   the work lives in `packages/auth/` (port + adapter) and per-app
   middleware.

## Required external accounts

Set these up and put their keys in `.env`. See
`docs/reference/env-vars.md` for the full var-by-var table. Note: the
config schemas hard-fail at boot on missing required vars — there are
no silent fallbacks.

| Service | Required? | What it does | Where used |
| --- | --- | --- | --- |
| Clerk | Required | Auth across all apps (publishable + secret + webhook) | api, web, mobile, desktop |
| PostgreSQL | Required (local: `docker compose up db`) | Primary database (`DATABASE_URL`) | api |
| Redis | Required (local: `docker compose up redis`) | Cache + job queue (`REDIS_URL`) | api |
| PostHog | Required unless `POSTHOG_ENABLED=false` | Analytics + feature flags | all |
| Stripe | Required if charging web users | Web payment processor (sits *behind* RevenueCat for mobile/desktop subscriptions) | api, web |
| RevenueCat | Required if charging mobile/desktop users | Cross-platform subscription state (primary billing front) | api, web, mobile, desktop |
| Apple App Store | Required if iOS monetized | IAP receipt validation | api, mobile |
| Google Play | Required if Android monetized | IAP receipt validation | api, mobile |

RevenueCat is the primary billing surface across every app — Stripe is
only the web-side payment processor sitting behind it. All app-side
billing UI talks to RevenueCat SDKs.

## Where to go next

- `ONBOARDING.md` — day-1 / week-1 / week-2 ramp
- `docs/tutorials/getting-started.md` — full first-boot walkthrough
- `docs/packages/INDEX.md` — package-by-package reference
- `docs/reference/env-vars.md` — every env var, what it's for
- `CONVENTIONS.md` — coding standards, layer boundaries
- `CONTRIBUTING.md` — branching, commits, PR checklist
- `docs/index.md` — full doc tree (Diátaxis)
