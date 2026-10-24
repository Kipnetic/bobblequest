FROM oven/bun:1.4.4-alpine AS base
WORKDIR /app

# Production-only dependencies
FROM base AS prod-deps
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
COPY turbo.json tsconfig.base.json ./
RUN bun install --frozen-lockfile --production --filter './apps/api'

# Runtime — source-run via bun (no bundle step; bun transpiles TS natively)
FROM base AS runtime
LABEL com.template-repo.managed=true
WORKDIR /app
# Root-level workspace manifests (needed for bun workspace resolution)
COPY package.json tsconfig.base.json ./
# Bun hoists deps to root node_modules; workspace pkgs are symlinked from there.
# Per-package node_modules also exist for postinstall/peer-dep spillover.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps /app/packages ./packages
# API source
COPY apps/api/ ./apps/api/

RUN apk add --no-cache curl

EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1
CMD ["bun", "run", "apps/api/src/index.ts"]
