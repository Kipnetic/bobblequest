FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

# Install all dependencies (including devDeps needed for next build)
FROM base AS deps
COPY package.json bun.lock ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/website/package.json ./apps/website/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/desktop/package.json ./apps/desktop/
# scripts/stack is declared as a workspace in the root package.json;
# bun install resolves all workspaces so its package.json must be present.
COPY scripts/stack/package.json ./scripts/stack/
COPY apps/web/ ./apps/web/
COPY turbo.json tsconfig.base.json ./
RUN bun install --frozen-lockfile --filter './apps/web'

# Production-only dependencies for the runtime image
FROM base AS prod-deps
COPY package.json bun.lock ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/website/package.json ./apps/website/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/desktop/package.json ./apps/desktop/
COPY scripts/stack/package.json ./scripts/stack/
COPY apps/web/ ./apps/web/
COPY turbo.json tsconfig.base.json ./
RUN bun install --frozen-lockfile --production --filter './apps/web'

FROM deps AS build
# Build-time env vars — required by Next.js static generation.
# NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and NEXT_PUBLIC_TRPC_URL are required fields
# in WebClientConfigSchema (min(1) and .url() validators respectively).
# NEXT_PUBLIC_* vars are inlined by the Next.js compiler at build time.
# Defaults are safe placeholders for local/CI builds; production values must be
# supplied via docker-compose build.args or --build-arg.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_placeholder_replace_me
ARG NEXT_PUBLIC_TRPC_URL=http://localhost:3000/trpc
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ARG NEXT_PUBLIC_REVENUECAT_PUBLIC_API_KEY=
ARG NEXT_PUBLIC_ENVIRONMENT=development
ARG SKIP_ENV_VALIDATION=1
# POSTHOG_ENABLED=false ensures the server-side composition root selects the
# NoOp analytics tracker at build time. Without a real POSTHOG_API_KEY the
# registerAnalyticsDI() hard-fail would abort `next build` when collecting
# page data (layout.tsx imports logger which triggers getContainer()).
# At runtime the container's env_file overrides this to the desired value.
ARG POSTHOG_ENABLED=false
ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_TRPC_URL=$NEXT_PUBLIC_TRPC_URL
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV NEXT_PUBLIC_REVENUECAT_PUBLIC_API_KEY=$NEXT_PUBLIC_REVENUECAT_PUBLIC_API_KEY
ENV NEXT_PUBLIC_ENVIRONMENT=$NEXT_PUBLIC_ENVIRONMENT
ENV SKIP_ENV_VALIDATION=$SKIP_ENV_VALIDATION
ENV POSTHOG_ENABLED=$POSTHOG_ENABLED
RUN mkdir -p apps/web/public && bun run --filter=@t/web build

FROM base AS runtime
LABEL com.template-repo.managed=true
WORKDIR /app
# Root workspace manifests needed for bun workspace resolution and --filter flag
COPY package.json tsconfig.base.json turbo.json ./
# Bun hoists shared deps to root node_modules; copy both root and per-app node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=prod-deps /app/packages ./packages

RUN apk add --no-cache curl

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3000}/api/health || exit 1
CMD ["bun", "run", "--filter=@t/web", "start"]
