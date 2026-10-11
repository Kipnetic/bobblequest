# Reference: tRPC procedures

## What this file is for

Inventory of every tRPC procedure exposed by `apps/api`. Use it to understand the available
RPC surface before wiring a new client call, writing integration tests, or auditing auth guards.

## When to update it

Update this file whenever a router file under `apps/api/src/routers/` gains, removes, or changes
a procedure — including input schema changes, type changes, or auth guard changes.

## How to regenerate

This document is hand-curated for v1. Source of truth is `apps/api/src/routers/index.ts` and the
child router files it imports. Future TODO: see ADR 006 — once the team decides between
`trpc-panel`, `trpc-ui`, and `trpc-openapi`, generate this reference automatically. Track via ADR
006 follow-up.

---

## Router shape

`AppRouter` is assembled in `apps/api/src/routers/index.ts` and exported as a TypeScript type.
All five client apps (`apps/web`, `apps/mobile`, `apps/desktop`, `apps/website`, and any future
clients) import it as a type-only import — no runtime dependency on `apps/api`. The tRPC client
in each app is pointed at `NEXT_PUBLIC_TRPC_URL` / `EXPO_PUBLIC_API_URL` / `VITE_API_URL` at
runtime.

```text
AppRouter
  auth      → authRouter      (apps/api/src/routers/auth.ts)
  users     → usersRouter     (apps/api/src/routers/users.ts)
  projects  → projectsRouter  (apps/api/src/routers/projects.ts)
```

Two middleware layers gate access:

- `publicProcedure` — no auth required; `ctx.user` may be null.
- `protectedProcedure` — requires a valid Clerk session; narrows `ctx.userId` and `ctx.user` to
  non-null. Returns `UNAUTHORIZED` when no session is present.

An `adminProcedure` layer also exists (`apps/api/src/trpc/index.ts:46`) but is not yet used by
any router procedure.

---

## Procedures

### `auth.me`

| Field | Value |
| --- | --- |
| Type | query |
| Auth | public |
| Input | none |
| Output | `ctx.user` (Clerk session projection: `{ id, role, email }`) or `null` |
| File | `apps/api/src/routers/auth.ts:17` |

Returns the Clerk session projection for the current request, or `null` for unauthenticated
requests.

---

### `auth.updateProfile`

| Field | Value |
| --- | --- |
| Type | mutation |
| Auth | protected |
| Input | `{ displayName?: string (min 1, max 255) }` |
| Output | Updated user record from `UserRepository.update` |
| File | `apps/api/src/routers/auth.ts:22` |

Updates the current user's profile metadata. Resolves the internal `users.id` from the Clerk id
with `requireInternalUserId` (NOT_FOUND until the Clerk webhook has mirrored the user), then
calls `ctx.userRepository.update`.

---

### `users.me`

| Field | Value |
| --- | --- |
| Type | query |
| Auth | protected |
| Input | none |
| Output | `ctx.user` (Clerk session projection, non-null) |
| File | `apps/api/src/routers/users.ts:12` |

Returns the authenticated user's session projection.

---

### `users.update`

| Field | Value |
| --- | --- |
| Type | mutation |
| Auth | protected |
| Input | `{ displayName: string (min 1, max 255) }` |
| Output | Updated user record from `UserRepository.update` |
| File | `apps/api/src/routers/users.ts:16` |

Updates the current user's `displayName`. Resolves the internal `users.id` with
`requireInternalUserId` (as `auth.updateProfile` does), then calls `ctx.userRepository.update`.

---

### `projects.list`

| Field | Value |
| --- | --- |
| Type | query |
| Auth | protected |
| Input | `{ limit: number (1–100, default 10), offset: number (min 0, default 0) }` |
| Output | Projects owned by `ctx.userId` from `ctx.projectRepository.findByOwnerId` |
| File | `apps/api/src/routers/projects.ts:15` |

Returns a paginated list of projects scoped to the authenticated user.

---

### `projects.getById`

| Field | Value |
| --- | --- |
| Type | query |
| Auth | protected |
| Input | `{ id: string (UUID) }` |
| Output | `Project` record |
| File | `apps/api/src/routers/projects.ts:27` |

Returns a single project by UUID. Throws `NOT_FOUND` if the project does not exist or is not
owned by `ctx.userId`.

---

### `projects.create`

| Field | Value |
| --- | --- |
| Type | mutation |
| Auth | protected |
| Input | `{ name: string (min 1, max 255), description?: string }` |
| Output | Created `Project` record |
| File | `apps/api/src/routers/projects.ts:39` |

Creates a new project owned by `ctx.userId`.

---

### `projects.update`

| Field | Value |
| --- | --- |
| Type | mutation |
| Auth | protected |
| Input | `{ id: string (UUID), name?: string (min 1, max 255), description?: string, status?: 'active' \| 'archived' \| 'deleted' }` |
| Output | Updated `Project` record |
| File | `apps/api/src/routers/projects.ts:53` |

Partial-updates a project by UUID. Throws `NOT_FOUND` if the project does not exist or is not
owned by `ctx.userId`.

---

### `projects.delete`

| Field | Value |
| --- | --- |
| Type | mutation |
| Auth | protected |
| Input | `{ id: string (UUID) }` |
| Output | Result of `ctx.projectRepository.delete` |
| File | `apps/api/src/routers/projects.ts:75` |

Deletes a project by UUID. Throws `NOT_FOUND` if the project does not exist or is not owned by
`ctx.userId`.

---

## Future work

- Automate this reference: once ADR 006 resolves the `trpc-panel` / `trpc-ui` / `trpc-openapi`
  decision, generate procedure docs from the router at CI time.
- Add `adminProcedure`-gated routes when admin-only surfaces are needed (the middleware is already
  defined in `apps/api/src/trpc/index.ts`).
- Subscriptions: no subscription procedures are defined yet; add to this reference when the first
  one ships.

---

_Last reviewed: 2026-04-28 — owner: TBD_
