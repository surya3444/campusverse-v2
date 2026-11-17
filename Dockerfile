# One image per app, built once and promoted unchanged from test to the live environment.
# Targets: api, worker, migrate, web, admin. Configuration arrives at run time (ECS task
# definitions with Secrets Manager); nothing environment-specific is baked in.
#   docker build --target api -t campusverse-api .

FROM node:22-bookworm-slim AS base
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS source
COPY . .

# API, worker and migrations run TypeScript through tsx, as in development.
# ponytail: tsx compiles on start (a few seconds); bundle with esbuild if cold starts matter.
FROM source AS server-deps
RUN pnpm install --frozen-lockfile \
      --filter "@campusverse/api..." --filter "@campusverse/worker..." --filter "@campusverse/db..."

# Runtime images are distroless: Node and its libraries only (no shell, package manager or npm),
# running as a non-root user. The entrypoint is node, so CMD lists node's arguments.
FROM gcr.io/distroless/nodejs22-debian13:nonroot AS server
COPY --from=server-deps --chown=nonroot:nonroot /repo /repo
ENV NODE_ENV=production

FROM server AS api
WORKDIR /repo/apps/api
EXPOSE 4000
CMD ["--import", "tsx", "src/main.ts"]

FROM server AS worker
WORKDIR /repo/apps/worker
CMD ["--import", "tsx", "src/main.ts"]

FROM server AS migrate
WORKDIR /repo/packages/db
CMD ["--import", "tsx", "scripts/migrate.ts"]

# Next.js apps: standalone servers. APP_ENV at build only lets build-time imports load; the
# running container's APP_ENV decides the banner and behaviour.
FROM gcr.io/distroless/nodejs22-debian13:nonroot AS next-runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
WORKDIR /app

FROM source AS web-build
RUN pnpm install --frozen-lockfile --filter "@campusverse/web..."
RUN APP_ENV=test pnpm --filter @campusverse/web build

FROM next-runtime AS web
COPY --from=web-build --chown=nonroot:nonroot /repo/apps/web/.next/standalone ./
COPY --from=web-build --chown=nonroot:nonroot /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=nonroot:nonroot /repo/apps/web/public ./apps/web/public
ENV PORT=3000
EXPOSE 3000
CMD ["apps/web/server.js"]

FROM source AS admin-build
RUN pnpm install --frozen-lockfile --filter "@campusverse/admin..."
RUN APP_ENV=test pnpm --filter @campusverse/admin build

FROM next-runtime AS admin
COPY --from=admin-build --chown=nonroot:nonroot /repo/apps/admin/.next/standalone ./
COPY --from=admin-build --chown=nonroot:nonroot /repo/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=admin-build --chown=nonroot:nonroot /repo/apps/admin/public ./apps/admin/public
ENV PORT=3001
EXPOSE 3001
CMD ["apps/admin/server.js"]
