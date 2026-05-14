# FULL SWAP BY RICH — Deployment Guide

Real-time AI video face-swap streaming platform powered by Decart Lucy 2.1.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24, pnpm workspaces |
| API server | Express 5 (TypeScript, esbuild) |
| Frontend | React + Vite + Wouter + TanStack Query + shadcn/ui |
| Database | PostgreSQL + Drizzle ORM |
| AI Streaming | @decartai/sdk (Lucy 2.1 face-swap) |
| Auth | License-key based (no JWT for users; HMAC-signed tokens for admin) |

---

## Environment Variables

Create a `.env` file (or set these in your hosting platform):

```env
# Required
DATABASE_URL=postgresql://user:password@host:5432/dbname
SESSION_SECRET=your-random-secret-at-least-32-chars

# Optional overrides
NODE_ENV=production
PORT=8080
ADMIN_PASSWORD=your-admin-password   # default: admin123

# CORS (comma-separated list of your production domains)
# If unset, defaults to permissive in dev or REPLIT_DOMAINS in Replit
ALLOWED_ORIGINS=https://yourdomain.com
```

---

## Local Development

```bash
# 1. Install dependencies
npm install -g pnpm
pnpm install

# 2. Set env vars (copy and fill in)
cp .env.example .env   # or set DATABASE_URL and SESSION_SECRET manually

# 3. Push DB schema
pnpm --filter @workspace/db run push

# 4. Seed admin user (email: admin@fullswap.app, password: admin123)
pnpm --filter @workspace/scripts run seed-admin

# 5. Start API server (port 8080)
pnpm --filter @workspace/api-server run dev

# 6. Start frontend (separate terminal)
pnpm --filter @workspace/full-swap run dev
```

Frontend: http://localhost:5173  
API: http://localhost:8080

---

## Production Build

```bash
# Build API server (outputs to artifacts/api-server/dist/)
pnpm --filter @workspace/api-server run build

# Build frontend (outputs to artifacts/full-swap/dist/)
pnpm --filter @workspace/full-swap run build
```

### Serving in production

**API server**
```bash
node artifacts/api-server/dist/index.mjs
```

**Frontend** — serve `artifacts/full-swap/dist/` as static files behind a reverse proxy (nginx, Caddy, etc.).

---

## Deploying on Railway / Render / Fly.io

### Railway (recommended)

1. Connect this repo in Railway
2. Add a PostgreSQL service and copy the `DATABASE_URL`
3. Set env vars: `DATABASE_URL`, `SESSION_SECRET`, `NODE_ENV=production`
4. Add two services:
   - **API**: start command `node artifacts/api-server/dist/index.mjs`, build command `pnpm install && pnpm --filter @workspace/api-server run build`
   - **Frontend**: build command `pnpm install && pnpm --filter @workspace/full-swap run build`, publish directory `artifacts/full-swap/dist`
5. Run migrations: `pnpm --filter @workspace/db run push`
6. Seed admin: `pnpm --filter @workspace/scripts run seed-admin`

### Render

Same as Railway — set up two services (Web Service for API, Static Site for frontend). Set the same env vars.

### VPS / Docker

Use the included setup:
```bash
pnpm install
pnpm --filter @workspace/db run push
pnpm --filter @workspace/scripts run seed-admin
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/full-swap run build
```
Then serve with nginx or a process manager (pm2, systemd).

---

## Admin Access

| URL | Credentials |
|-----|-------------|
| `/admin` | admin@fullswap.app / admin123 |
| `/subadmin` | Sub-admin accounts (created in admin panel) |

**First-run checklist:**
1. Log in at `/admin`
2. Go to **Decart API Keys** → add your Decart API key + credits
3. Go to **Users** → create license keys and allocate minutes
4. Share the license keys with your users

---

## Key Architecture Notes

- **License-key auth** — users authenticate with a license key stored in `localStorage`, validated server-side on every stream start. No user accounts required.
- **Decart billing** — exactly 2 credits/second (120 credits/minute). Credit tracking is per-Decart-API-key, computed from session records.
- **Token caching** — Decart tokens are cached per license key and reused until <30 s remaining to avoid reconnect overhead.
- **Orphan sweeper** — a background job closes streaming sessions whose client died without sending `/stop`, billing the correct duration.
- **Pool management** — multiple Decart API keys are pooled with health-based round-robin. Failed keys enter a 15-min cooldown automatically.

---

## Database Schema

All schema lives in `lib/db/src/schema/`. Key tables:

| Table | Purpose |
|-------|---------|
| `license_keys` | User access keys + minute allocations |
| `sessions` | Streaming session records + billing timestamps |
| `decart_api_keys` | Decart API credentials + credit top-up history |
| `users` | Admin / sub-admin accounts only |
| `invoices` | Payment records |
| `pricing` | Per-minute rates (USD, USDT, GHS) |
| `chat_messages` | Admin ↔ user chat |

To regenerate API hooks after schema changes:
```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Monorepo Structure

```
artifacts/
  api-server/     Express API (port 8080)
  full-swap/      React + Vite frontend
lib/
  db/             Drizzle schema + migrations
  api-spec/       OpenAPI YAML + Orval codegen config
  api-client-react/  Generated TanStack Query hooks
  api-zod/        Generated Zod validation schemas
scripts/
  seed-admin.ts   Create/reset admin user
```
