# How to add a route

Adds a new tRPC procedure to the API and propagates full TypeScript types to every client app.

## What this file is for

Step-by-step reference for developers adding an HTTP endpoint (tRPC procedure) to
`apps/api`. Follow this when you know what you want to expose — not when you are still
designing the data model.

## When to update it

- The router file layout changes (new directory conventions, new base procedure types)
- The `appRouter` registration pattern is restructured
- A new client app is added to the monorepo that needs to import `AppRouter`

---

**Audience:** developers adding tRPC endpoints to the API
**Prerequisites:** repo cloned and running locally per `docs/tutorials/getting-started.md`
**Outcome:** a new tRPC procedure callable from any of the five client apps with full TS types

---

## Steps

### 1. Choose the namespace

Decide which router file owns the new procedure. Existing namespaces:

| File | Namespace | Purpose |
| --- | --- | --- |
| `apps/api/src/routers/auth.ts` | `auth` | Clerk session projection, profile edits |
| `apps/api/src/routers/users.ts` | `users` | App-side user records |
| `apps/api/src/routers/projects.ts` | `projects` | Project CRUD |

If none fits, create `apps/api/src/routers/<namespace>.ts`.

### 2. Define the input/output schema

In the router file, define a Zod schema for the procedure's input. Output types are inferred.

```ts
import { z } from 'zod'

const createItemInput = z.object({
  name: z.string().min(1).max(255),
  ownerId: z.string().uuid(),
})
```

### 3. Implement the procedure

Use `publicProcedure` for unauthenticated access or `protectedProcedure` for routes that require
a valid Clerk session. Both are imported from `../trpc`.

`ctx.userId` is the Clerk id (`user_xxx`). Owner columns reference the internal `users.id` uuid,
so resolve it with `requireInternalUserId(ctx)` before storing or comparing an owner.

```ts
import { requireInternalUserId } from '../lib/auth/internalUser'
import { protectedProcedure, router } from '../trpc'

export const itemsRouter = router({
  create: protectedProcedure
    .input(createItemInput)
    .mutation(async ({ ctx, input }) => {
      return ctx.itemRepository.create({ ...input, ownerId: await requireInternalUserId(ctx) })
    }),

  list: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(100).default(10) }))
    .query(async ({ ctx, input }) => {
      return ctx.itemRepository.findByOwnerId(await requireInternalUserId(ctx), input)
    }),
})
```

### 4. Register on the app router

Open `apps/api/src/routers/index.ts` and add the import and namespace key:

```ts
import { itemsRouter } from './items'

export const appRouter = router({
  auth: authRouter,
  users: usersRouter,
  projects: projectsRouter,
  items: itemsRouter,   // add this line
})
```

`AppRouter` is re-exported from the same file (`export type AppRouter = typeof appRouter`) — no
further change is required for type propagation.

### 5. (Optional) Write a route-level integration test

Create `apps/api/src/routers/__tests__/items.test.ts`. Use `appRouter.createCaller(ctx)` with a
mocked context — the existing `routers.test.ts` is the pattern to follow:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '../../trpc/context'
import { appRouter } from '../index'

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    userId: 'user_1',
    user: { id: 'user_1', email: 'u@ex.com', role: 'user' },
    itemRepository: {
      create: vi.fn().mockResolvedValue({ id: 'item_1', name: 'Widget' }),
      findByOwnerId: vi.fn().mockResolvedValue([]),
    } as unknown as Context['itemRepository'],
    // ... other required context fields
    ...overrides,
  }
}

describe('items router', () => {
  it('create returns the new item', async () => {
    const caller = appRouter.createCaller(makeContext())
    const result = await caller.items.create({ name: 'Widget', ownerId: 'user_1' })
    expect(result.name).toBe('Widget')
  })
})
```

Run with: `bunx turbo test --filter @t/api`

### 6. Verify type propagation in a client

In any client app (e.g., `apps/web`), import `AppRouter` and confirm the new namespace appears
in the type:

```ts
import type { AppRouter } from '@t/api'
// AppRouter['_def']['record']['items'] should resolve — no `any`, no `unknown`
```

In practice, you will see autocomplete for `trpc.items.create.mutate(...)` in the IDE as soon as
the `appRouter` export is updated.

---

## Verification

```bash
bunx turbo typecheck
```

Zero errors confirms the procedure is fully typed and propagated to all client workspaces.

To exercise the procedure at runtime, start the dev server (`bun run dev` in `apps/api`) and call
the tRPC endpoint via your preferred client or `curl` against `http://localhost:3001/trpc`.

---

## Troubleshooting

- **Type does not propagate to the client** — confirm `AppRouter` is exported from
  `apps/api/src/routers/index.ts` and that the client imports it (not a stale local copy).
- **404 on the endpoint** — the router is not registered. Re-check step 4; ensure the namespace
  key is present in the `router({ ... })` call.
- **`protectedProcedure` throws `UNAUTHORIZED`** — the Clerk session header is missing from the
  request. Pass `Authorization: Bearer <token>` or use a test context with `userId` set.
- **Input validation error** — Zod rejects the payload shape. Check the schema in step 2 against
  the actual request body.

---

## See also

- `docs/tutorials/add-a-trpc-procedure.md` — tutorial that walks through the same steps with
  explanations (start here if you are new to tRPC)
- `docs/adr/006-trpc.md` — ADR explaining why tRPC was chosen
- `apps/api/src/routers/index.ts` — app router registration file
- `apps/api/src/routers/__tests__/routers.test.ts` — full integration test reference

---

Last reviewed: 2026-04-28 — owner: TBD
