# FULL SWAP BY RICH

Real-time AI video face-swap streaming platform powered by Decart Lucy 2.1. Users activate a license key to access the live streaming studio where Decart AI transforms their camera feed in real time.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at /api)
- `pnpm --filter @workspace/full-swap run dev` — run the frontend (Vite, port varies)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed-admin` — create/reset the admin user

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (artifacts/api-server, port 8080)
- Frontend: React + Vite + Wouter + TanStack Query + shadcn/ui (artifacts/full-swap, path /)
- DB: PostgreSQL + Drizzle ORM
- AI Streaming: @decartai/sdk (Lucy 2.1 face-swap)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — Drizzle table definitions (users, license-keys, sessions, pricing, chat-messages, decart-keys, etc.)
- `lib/api-spec/openapi.yaml` — OpenAPI 3.0 spec (source of truth for API contract)
- `lib/api-client-react/src/generated/` — Generated React Query hooks
- `lib/api-zod/src/generated/api.ts` — Generated Zod validation schemas
- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/` — Auth, token-cache, Decart client, billing helpers
- `artifacts/full-swap/src/pages/` — All frontend pages (login, stream, dashboard, admin/*, subadmin/*)
- `artifacts/full-swap/src/components/` — Layout, admin-layout, license-modal, chat-widget, UI primitives
- `scripts/src/seed-admin.ts` — Admin user seeder

## Decart Billing

- Decart charges **2 credits/second = 120 credits/minute**
- `minutesAllocated = decartCredits / 120`
- Token cache reuses tokens with ≥30s remaining to avoid reconnect waste
- Streaming session tracked in `sessions` table with credit burn logged per second

## Admin Access

- Main admin: `/admin` — email: `admin@fullswap.app`, password: `admin123` (default, set ADMIN_PASSWORD env to override)
- Sub-admin: `/subadmin`
- License key dashboard: `/admin/users` — add minutes, enable/disable keys
- Decart key management: `/admin/decart-keys` — feed API keys and credits
- Pricing config: `/admin/pricing` — set per-minute rates in USD/USDT/GHS

## Architecture decisions

- License-key auth (not JWT/sessions) — keys stored in localStorage, validated server-side on every stream start
- Token caching avoids Decart reconnect overhead: reuse a valid Decart token until <30s remaining
- All Decart credentials stored in DB (decart_keys table), rotated by admin
- CORS uses `REPLIT_DOMAINS` env in production (not hardcoded domain)
- Orval zod codegen uses `mode: "single"` to avoid duplicate export collision between Zod schemas and TypeScript interfaces

## Product

- **License key gate** — users must enter a valid license key to access the streaming studio
- **Real-time face-swap stream** — webcam feed transformed by Decart Lucy 2.1 AI in real time
- **Popout window** — float the transformed video feed over other apps (OBS virtual camera integration)
- **License dashboard** — users see their remaining minutes and purchase more
- **Admin panel** — manage license keys, credit minutes, Decart API keys, pricing, chat with users, view analytics
- **Sub-admin system** — sub-admins can sell licenses and manage their own users

## User preferences

- Preserve all "loopholes" from original FULLSWAPBYRICH repo
- Decart billing: exactly 2 credits/sec, 120 credits/min
- Token caching to avoid reconnect waste

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after any openapi.yaml change — api-zod uses mode=single to avoid duplicate exports
- `DATABASE_URL` must be set (Replit PostgreSQL integration)
- `SESSION_SECRET` must be set for admin password hashing (stored in Replit secrets)
- The `minimumReleaseAgeExclude` in pnpm-workspace.yaml includes `@decartai/sdk` so it can be installed without the 1-day freshness delay

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Production Safety Rules

**This is a live, revenue-generating streaming platform. These rules apply to every AI builder and every code change.**

### Before modifying any billing, settlement, heartbeat, websocket, session, or reconciliation logic:

- Analyze the existing live production flow first
- Preserve all existing execution order
- Preserve timing-sensitive behavior
- Preserve async sequencing
- Preserve all fallback paths
- Preserve all retry logic
- Preserve existing cleanup logic
- Preserve existing session state transitions

### Non-negotiable constraints

- Do NOT simplify or consolidate existing billing flows even if they appear redundant. Existing redundancy may be intentional for production safety.
- The current production system already works and is financially profitable. The objective is observability and synchronization — NOT billing redesign.
- All new analytics and reconciliation systems must operate as passive observers first before influencing any calculations.
- No existing production calculation should be replaced unless the replacement is: (a) mathematically identical, (b) backward-compatible, (c) fully tested against historical sessions, and (d) protected behind feature flags.

### Implementation order — always follow this sequence

1. Add logging
2. Add observability
3. Add reconciliation views
4. Compare old vs new metrics
5. Validate consistency
6. Only then allow optional future optimization

### When in doubt

If there is ever uncertainty between **preserving production stability** and **improving code cleanliness** — always choose production stability.

Prevent regressions, timing drift, billing drift, session duplication, accidental double deductions, websocket race conditions, and reconciliation mismatches at all costs.
