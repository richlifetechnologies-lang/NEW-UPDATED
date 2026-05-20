FROM node:22-slim

  WORKDIR /app

  # Enable corepack (bundled with Node 22) for pnpm
  RUN corepack enable && corepack prepare pnpm@9 --activate

  # Copy workspace config + lockfile
  COPY package.json pnpm-workspace.yaml ./
  COPY pnpm-lock.yaml* ./

  # Copy all package.json manifests for dependency layer caching
  COPY lib/api-client-react/package.json ./lib/api-client-react/
  COPY lib/api-spec/package.json ./lib/api-spec/
  COPY lib/api-zod/package.json ./lib/api-zod/
  COPY lib/db/package.json ./lib/db/
  COPY scripts/package.json ./scripts/
  COPY artifacts/api-server/package.json ./artifacts/api-server/
  COPY artifacts/full-swap/package.json ./artifacts/full-swap/

  # Install all workspace dependencies (esbuild/core-js build scripts allowed via package.json pnpm config)
  RUN pnpm install --no-frozen-lockfile

  # Copy all source files
  COPY . .

  # Build (typecheck libs, build frontend + API server)
  RUN pnpm run build:railway

  # Start the API server (PORT is injected by Railway at runtime)
  CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
  