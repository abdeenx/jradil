# syntax=docker/dockerfile:1

# Production image for Dokploy (build type: Dockerfile).
#
# The build stage installs the exact toolchain the lockfile was written with:
# pnpm 12 (the lockfile format and the `catalog:` protocol need it) on Node 24.
# The runtime stage needs only `.output`: Nitro bundles every server dependency,
# so no node_modules ship in the final image.
#
# Configuration comes from the environment at run time — MONGODB_URI,
# ADMIN_PASSWORD, APP_URL and the optional ones in `.env.example`. Nothing is
# baked in at build time.

FROM node:24-slim AS build
WORKDIR /app

RUN npm install --global pnpm@12.11.2

# Dependencies first, so a code-only change reuses this layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=jradil-pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

FROM node:24-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=node:node /app/.output ./.output

USER node
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
