FROM node:22-slim

  WORKDIR /app

  # Enable corepack for pnpm management (corepack is bundled with Node 22)
  RUN corepack enable

  # Copy package manifests for layer caching
  COPY package.json pnpm-workspace.yaml ./
  COPY pnpm-lock.yaml* ./

  # Copy all package.json files
  COPY artifacts/api-server/package.json ./artifacts/api-server/
  COPY lib/api-spec/package.json ./lib/api-spec/
  COPY lib/db/package.json ./lib/db/
  COPY lib/logger/package.json ./lib/logger/

  # Install with pnpm (corepack activates the right version)
  RUN pnpm install --no-frozen-lockfile

  # Copy remaining source
  COPY . .

  # Build the project
  RUN pnpm run build:railway

  # Expose Railway-provided port
  EXPOSE 5000

  # Start the API server
  CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
  