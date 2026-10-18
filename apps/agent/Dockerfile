# Build context: the repo root (`fly deploy -c apps/agent/fly.toml` from the root, or
# `docker build -f apps/agent/Dockerfile .`). The agent runs TypeScript directly with tsx (PLAN §5).
FROM node:22-slim
ENV NODE_ENV=production COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Manifests first so the dependency layer caches across source changes. Every workspace manifest is copied
# so the frozen lockfile matches; only the agent and its workspace deps are installed.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY apps/agent/package.json apps/agent/
COPY apps/venue/package.json apps/venue/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter "@tab/agent..."

COPY tsconfig.base.json ./
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
COPY apps/agent/tsconfig.json apps/agent/
COPY apps/agent/src apps/agent/src
COPY apps/agent/scripts apps/agent/scripts
COPY apps/agent/fixtures apps/agent/fixtures
COPY db/migrations db/migrations

WORKDIR /app/apps/agent
USER node
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/index.ts"]
