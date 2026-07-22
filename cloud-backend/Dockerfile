# cloud-backend — standalone Parallel Code service, deployable to Fly.io.
#
# Build context is this directory (cloud-backend/): the checked-in
# src/registry.ts (kept in sync with electron/ultrakod/registry.ts by
# `npm run sync-registry` during local dev/CI — see scripts/sync-registry.mjs)
# means the build needs nothing from outside this directory.
#
# The container itself is the task-isolation boundary (see src/coordinator.ts),
# so the CLI agents it spawns (claude-code, codex, gemini) must be installed
# directly in this image rather than in a nested Docker layer. Not multi-stage:
# the same tool list is needed at runtime as at build time, so splitting stages
# would only duplicate the apt/npm installs for no image-size win.
#
# Build:  docker build -t cloud-backend:latest cloud-backend/
# Run:    docker run -p 7777:7777 -v cloud-backend-data:/data cloud-backend:latest
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Build tools (node-pty needs a C++ toolchain + python3 for node-gyp) + git +
# the runtime shell agents run in.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git openssh-client gnupg \
    build-essential python3 \
    bash procps \
    && rm -rf /var/lib/apt/lists/*

# Node 22 LTS via NodeSource
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
         | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
         > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g npm@10

# AI agent CLIs — spawned directly in this container (no nested Docker mode here).
RUN npm install -g @anthropic-ai/claude-code @openai/codex @google/gemini-cli

# Default git config so commits work out of the box inside the container.
# safe.directory '*' is required because the first-deploy repo clone happens
# via `fly ssh console` (root) while the server itself runs as the `agent`
# user below — git's dubious-ownership check otherwise refuses to touch a
# repo owned by a different user, which every git call in git.ts then
# swallows into a misleading "repository with no commits" error (reproduced
# on a real deploy). Safe here since this container is single-tenant, one
# repo at a time, with no cross-user trust boundary to protect.
RUN git config --system init.defaultBranch main \
    && git config --system advice.detachedHead false \
    && git config --system --add safe.directory '*'

# Non-root user that owns the app and the persistent data volume.
RUN groupadd --gid 1000 agent \
    && useradd --uid 1000 --gid agent --shell /bin/bash --create-home agent \
    && mkdir -p /data && chown agent:agent /data

ENV SHELL=/bin/bash \
    HOME=/home/agent \
    DATA_DIR=/data \
    HOST=0.0.0.0 \
    PORT=7777

WORKDIR /app
COPY --chown=agent:agent package.json package-lock.json ./
RUN npm ci

COPY --chown=agent:agent tsconfig.json ./
COPY --chown=agent:agent src ./src
# Pre-built by `npm run sync-remote-client` (must be run and committed before
# building this image — see README's "Browser access"). The mobile/browser
# web client's source (src/remote/*) lives outside this directory, which is
# the entire build context Docker sees, so it can't be built in this stage.
COPY --chown=agent:agent public ./public
RUN npm run build && rm -rf src tsconfig.json && npm prune --omit=dev

# Set only after the build: npm treats NODE_ENV=production as an implicit
# --omit=dev for every subsequent npm command in this image, including the
# `npm ci` above — set any earlier and it silently skips devDependencies
# (typescript among them), so `npm run build`'s `tsc` isn't on PATH and the
# build fails with "tsc: not found" (reproduced on a real Fly.io build).
ENV NODE_ENV=production

USER agent
EXPOSE 7777
VOLUME ["/data"]

CMD ["node", "dist/index.js"]
