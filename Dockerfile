FROM node:22-slim

  WORKDIR /app

  # Enable corepack (bundled with Node 22) for pnpm
  RUN corepack enable

  # Copy workspace config + lockfile
  COPY package.json pnpm-workspace.yaml ./
  COPY pnpm-lock.yaml* ./

  # Copy all package.json manifests for dependency resolution (layer cache)
  COPY lib/api-client-react/package.json ./lib/api-client-react/
  COPY lib/api-spec/package.json ./lib/api-spec/
  COPY lib/api-zod/package.json ./lib/api-zod/
  COPY lib/db/package.json ./lib/db/
  COPY scripts/package.json ./scripts/
  COPY artifacts/api-server/package.json ./artifacts/api-server/
  COPY artifacts/full-swap/package.json ./artifacts/full-swap/

  # Install all workspace dependencies
  RUN pnpm install --no-frozen-lockfile

  # Copy all source files
  COPY . .

  # Build (typecheck libs, then build frontend + API server)
  RUN pnpm run build:railway

  # Start the API server (PORT is injected by Railway)
  CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
  