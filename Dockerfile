# syntax=docker/dockerfile:1.10
# Bun bundles the app and its dependencies into dist/server.js, and the
# background jobs into dist/worker.js (run it as a second container with
# `bun --no-install dist/worker.js`; the SDL files are
# imported as text by the module manifests): the image holds dist/ only, no
# TypeScript and no node_modules (`bun build` copies the native renderer of
# @napi-rs/canvas next to dist/worker.js as an asset, built for the image's own
# platform). Pinned to Bun 1.4.5 exactly, moved together
# with ci.yml's setup-bun and @types/bun.

FROM oven/bun:1.4.5 AS build
WORKDIR /app
# The in-memory Mongo and Redis are for the specs only: no binary download, no
# compilation (the image has no make).
ENV MONGOMS_DISABLE_POSTINSTALL=1 \
    REDISMS_DISABLE_POSTINSTALL=1
COPY package.json bun.lock* bunfig.toml* ./
RUN --mount=type=secret,id=npm_read,env=NPM_SOFTISTX_READ_TOKEN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.5-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
USER bun
EXPOSE 3000
CMD ["bun", "--no-install", "dist/server.js"]
