FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

# Install all dependencies (including devDeps needed for next build)
FROM base AS deps
COPY package.json bun.lock ./
COPY patches/ ./patches/
COPY packages/ ./packages/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/website/package.json ./apps/website/
COPY apps/mobile/package.json ./apps/mobile/
COPY apps/desktop/package.json ./apps/desktop/
# scripts/stack is declared as a workspace in the root package.json;
# bun install resolves all workspaces so its package.json must be present.
COPY scripts/stack/package.json ./scripts/stack/
COPY apps/website/ ./apps/website/
COPY turbo.json tsconfig.base.json ./
RUN bun install --frozen-lockfile --filter './apps/website'

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
COPY apps/website/ ./apps/website/
COPY turbo.json tsconfig.base.json ./
RUN bun install --frozen-lockfile --production --filter './apps/website'

FROM deps AS build
# Build-time env vars — required by Next.js static generation.
# NEXT_PUBLIC_* vars are inlined by the Next.js compiler at build time.
# Defaults are safe placeholders for local/CI builds; production values must be
# supplied via docker-compose build.args or --build-arg.
# SKIP_ENV_VALIDATION=1 defers server-only env validation (e.g. SITE_URL) to
# first request — the same Docker image runs in dev/staging/prod without a rebuild.
# SITE_URL is NOT a build arg; it is runtime-only (see docker-compose.yml environment:).
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ARG SKIP_ENV_VALIDATION=1
ENV NEXT_PUBLIC_POSTHOG_KEY=$NEXT_PUBLIC_POSTHOG_KEY
ENV NEXT_PUBLIC_POSTHOG_HOST=$NEXT_PUBLIC_POSTHOG_HOST
ENV SKIP_ENV_VALIDATION=$SKIP_ENV_VALIDATION
RUN mkdir -p apps/website/public && bun run --filter=@t/website build

FROM base AS runtime
LABEL com.template-repo.managed=true
WORKDIR /app
# Root workspace manifests needed for bun workspace resolution and --filter flag
COPY package.json tsconfig.base.json turbo.json ./
# Bun hoists shared deps to root node_modules; copy both root and per-app node_modules
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/website/node_modules ./apps/website/node_modules
COPY --from=build /app/apps/website/.next ./apps/website/.next
COPY --from=build /app/apps/website/package.json ./apps/website/
COPY --from=build /app/apps/website/public ./apps/website/public
COPY --from=prod-deps /app/packages ./packages

RUN apk add --no-cache curl

EXPOSE 3002
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3002}/api/health || exit 1
CMD ["bun", "run", "--filter=@t/website", "start"]
