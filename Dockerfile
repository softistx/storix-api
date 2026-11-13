# Bun bundles the app and its dependencies into dist/server.js (the SDL files are
# imported as text by the module manifests): the image holds dist/ only, no
# TypeScript and no node_modules. Pinned to Bun 1.4.4 exactly, moved together
# with ci.yml's setup-bun and @types/bun.

FROM oven/bun:1.4.4 AS build
WORKDIR /app
# The in-memory Mongo and Redis are for the specs only: no binary download, no
# compilation (the image has no make).
ENV MONGOMS_DISABLE_POSTINSTALL=1 \
    REDISMS_DISABLE_POSTINSTALL=1
COPY package.json bun.lock* bunfig.toml* .npmrc ./
# GITHUB_TOKEN (read:packages) is a build secret for the @softistx scope:
# docker build --secret id=GITHUB_TOKEN,env=GITHUB_TOKEN
RUN --mount=type=secret,id=GITHUB_TOKEN,env=GITHUB_TOKEN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1.4.4-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
USER bun
EXPOSE 3000
CMD ["bun", "--no-install", "dist/server.js"]
