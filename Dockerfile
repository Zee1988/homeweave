# HomeWeave (织家) production image — Home Assistant OS App.
#
# Build context MUST be the repository root: the pnpm workspace spans the root
# (`pnpm-lock.yaml`, `pnpm-workspace.yaml`) and `apps/api`, so a context of
# `./homeweave_app` cannot see the lockfile at all (02-RESEARCH.md §五 C-1).
#
# Shape: base -> build -> prod-deps -> runtime. The runtime stage copies exactly
# four paths out of the earlier stages. Nothing else survives, which is what keeps
# devDependencies, `src/`, `*.spec.ts` and `*.map` out of the shipped image
# (threat T-02-04, plan 02-03).
#
# Deliberately absent, with reasons:
#   - no HEALTHCHECK: the API exposes no HTTP endpoint until Phase 3, so a probe
#     would make the container report unhealthy forever (D-7). "It started" is
#     proven by the startup log line in scripts/ci/assert-image.sh instead.
#   - no VOLUME /data: Supervisor bind-mounts /data itself; a declared VOLUME would
#     additionally create an anonymous volume that no backup ever covers.
#   - no ARG/ENV/COPY secret plumbing: if a private registry token is ever needed it
#     goes through `RUN --mount=type=secret`, never through the image metadata,
#     because a leaked layer cannot be patched after the fact (threat T-02-03).
#
# Static rules enforced by `pnpm validate:dockerfile` (scripts/validate-dockerfile.mjs).

FROM node:22-bookworm-slim AS base

# Pinned pnpm: the root package.json has no `packageManager` field on purpose
# (02-RESEARCH.md §2), so the version lives here and nowhere else.
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

FROM base AS build

# The build stage is the only place that sees the whole tree; the runtime stage
# never does (see the prohibition on `COPY . .` below).
COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# `apps/api`'s own build script is `prisma generate && tsc -p tsconfig.json`, so the
# client is generated here and compiled into dist/. There is no separate generate
# step on purpose: a second invocation would only re-download the same artifacts.
#
# Note for the future: with Prisma 7's `prisma-client` generator the output is
# TypeScript compiled by tsc, and ENGINE_DECISION is RUST_FREE (no native query
# engine), which is why prod-deps does not re-run `prisma generate` below. If the
# decision ever flips to NATIVE_ENGINE, the engine binaries land in node_modules and
# prod-deps MUST regenerate or the image ships without an engine.
RUN pnpm --filter @homeweave/api build

FROM base AS prod-deps

# NODE_ENV=production is load-bearing twice: pnpm honours it for --prod, and the
# runtime stage inherits it.
ENV NODE_ENV=production

# Only the manifests are copied, so a source-only edit does not invalidate the
# dependency layer. The root manifest is included because the lockfile carries a
# root importer entry.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter @homeweave/api...

# `pnpm deploy` produces a self-contained bundle: package.json plus a node_modules
# whose symlinks resolve inside itself. That is the only layout that works here,
# because a plain `COPY /app/node_modules` would bring the pnpm *store* layout
# (`.pnpm/` plus links pointing at `/app`), which does not resolve once the tree is
# relocated to the runtime stage's `/app/dist`.
#
# VERIFIED LOCALLY: `pnpm@9.15.4 deploy --help` lists `-P, --prod` and has no
# `--legacy` flag (that flag arrives with pnpm 10), so the call below is the 9.15.4
# CLI surface. NOT VERIFIED: the actual deploy output shape needs a container.
# Fallback if the first CI run fails here: replace the runtime copy of
# ./node_modules with `COPY --from=prod-deps --chown=node:node /app/node_modules
# ./node_modules` AND additionally COPY `apps/api/node_modules`, because pnpm's
# default isolated linker keeps a package's own links under the package directory.
# Write down whichever path is actually used, in this comment.
RUN pnpm --filter @homeweave/api deploy --prod /prod

FROM node:22-bookworm-slim AS runtime

# Prisma's engine naming is tied to the OpenSSL series (bookworm = 3.0.x) and
# ca-certificates is needed for any outbound TLS. Both are installed explicitly
# instead of assumed present in the slim base (02-RESEARCH.md §3.4).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
WORKDIR /app

# /data is the Home Assistant App persistent volume. Creating it with the right
# owner means a first-run write succeeds even though the process is not root;
# VOLUME is deliberately not declared (Supervisor mounts it explicitly).
RUN mkdir -p /data && chown node:node /data

# Four paths, nothing else. `dist/` already contains dist/generated/prisma (the
# Prisma client is TypeScript compiled by tsc), and `prisma/` carries the migration
# history the image ships but does not run (D-1: no prisma CLI in the image).
COPY --from=build --chown=node:node /app/apps/api/dist ./dist
COPY --from=prod-deps --chown=node:node /prod/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/api/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/api/package.json ./package.json

# The compiled Prisma client does `require("@prisma/client/runtime/client")` — a
# value import, not a type import — so @prisma/client must stay a runtime dependency
# with its `runtime/` subpath intact. It is in `dependencies`, and `--prod` keeps it.
# The `prisma` CLI is a devDependency and must stay out (IMG-02).

USER node

EXPOSE 8099

CMD ["node","dist/main.js"]
