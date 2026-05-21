# System-Wide Frontend/Backend Billing Consistency Audit

**Project:** FullSwapByRich Admin Dashboard  
**Production:** https://fullswapbyrich.xyz

## Mission

Perform a COMPLETE frontend + backend consistency audit for the billing system and ensure the ENTIRE admin dashboard dynamically reflects the LIVE backend billing engine accurately across all tabs and UI sections.

---

## Critical Rule

The backend billing engine is the **ONLY source of truth**.

Frontend UI must NEVER:
- Hardcode billing rates
- Hardcode margins
- Hardcode stream ratios
- Hardcode API cost assumptions
- Duplicate backend business logic
- Independently invent calculations

ALL displayed values must derive dynamically from:
- Backend APIs
- Backend-calculated values
- Shared billing utilities
- Database-configured rates
- Live runtime billing logic

---

## Important Context

Billing rates are **DYNAMIC** and admin-configurable.

Values like `3 cr/s`, `5 cr/s`, `30.4%`, `117.4%`, `76.7%` are NOT permanent constants. They are ONLY examples from current live configuration and test data.

Frontend must automatically adapt whenever:
- Global billing rate changes
- Sub-admin rate changes
- Custom key rate changes
- API cost basis changes

---

## Mandatory First Step

Before modifying frontend UI — **INSPECT THE EXISTING BACKEND BILLING ENGINE COMPLETELY.**

Trace and understand:
- Billing rate resolution
- Wallet deduction logic
- Stream duration calculations
- Profit margin formulas
- Tier inheritance
- Effective billing source
- API cost basis usage
- Custom override priority
- Sub-admin inheritance
- Global fallback logic

Frontend must mirror backend behavior **EXACTLY**. Do NOT create parallel frontend billing logic.

---

## Live Deployment Status

Production deployment is LIVE and verified.

Recent successful deployments:
- `9df8acb` — 3-tier billing rate implementation
- `1a5895bd` — minutesAllocated display fix in Per-Key Monitor

Both deployments are already functioning correctly at backend level.

---

## Live Test Data (Ground Truth Validation)

The following real test keys currently exist in production DB and MUST be used as validation references during audit.

### `FSBT-FSBT-FSBT-TEST-1MIN`
- Wallet allocation: 1 minute
- Tier: GLOBAL
- Effective rate: dynamically resolved
- Current observed rate: 3 cr/s
- Real stream time observed: 0.77 min
- Observed margin: 30.4%

### `FSBT-FSBT-FSBT-TEST-30MIN`
- Wallet allocation: 30 minutes
- Tier: GLOBAL
- Effective rate: dynamically resolved
- Current observed rate: 3 cr/s
- Real stream time observed: 23.0 min
- Observed margin: 30.4%

### `FSBT-FSBT-FSBT-TEST-60MIN`
- Wallet allocation: 60 minutes
- Tier: GLOBAL
- Effective rate: dynamically resolved
- Current observed rate: 3 cr/s
- Real stream time observed: 46.0 min
- Observed margin: 30.4%

### `FSBT-FSBT-FSBT-SA-TEST`
- Wallet allocation: 45 minutes
- Tier: SUB-ADMIN
- Effective rate: dynamically resolved
- Current observed rate: 5 cr/s
- Real stream time observed: 20.7 min
- Observed margin: 117.4%

---

## Billing Priority System

Verify and preserve this exact priority order:

1. CUSTOM per-key override
2. SUB-ADMIN inherited rate
3. GLOBAL fallback

Frontend must accurately display:
- Resolved effective rate
- Source tier
- Tier badge
- Actual billing source

across ALL tabs consistently.

---

## Audit Scope — All UI Sections

Inspect ALL:
- Billing Rate tab
- Per-Key Billing Monitor
- Sub-Admin tab
- Analytics, tables, charts, widgets, cards
- Summary panels, progress bars, statistics
- Helper labels, profitability displays
- Stream estimators, modals, reports, exports
- Dashboard metrics

---

## Frontend Problems to Identify

Find ANY:
- Hardcoded billing values
- Legacy formulas
- Stale helper functions
- Inline calculations
- Duplicated logic
- Cached assumptions
- Outdated percentage formulas
- Incorrect wallet conversions
- Inconsistent stream duration calculations
- Mismatched tier displays
- Disconnected analytics

---

## Refactor Requirements

Create ONE centralized billing calculation layer.

Preferred approaches:
- Shared backend utility imports
- API-returned computed values
- Synchronized billing service/hooks

Frontend components must consume ONLY centralized values:
- `resolvedBillingRate`
- `effectiveTier`
- `realStreamTime`
- `walletBurnRate`
- `profitMargin`
- `apiCostBasis`

No duplicated calculations inside components.

---

## Dynamic Update Requirement

Whenever backend billing settings change — ALL tabs, analytics, percentages, stream calculations, charts, monitor tables, and summaries must immediately reflect the updated backend logic dynamically.

---

## Safe Engineering Rule

Primary task: **ALIGN FRONTEND WITH EXISTING BACKEND REALITY.**

Do NOT modify backend business logic unless a real backend inconsistency is discovered.

---

## Required Output

1. Full audit report
2. All inconsistent UI locations
3. Legacy formulas discovered
4. Backend source-of-truth mapping
5. Updated shared utilities/services
6. Components refactored
7. Validation results using live test keys
8. Before/after comparisons
9. Remaining risks
10. Final consistency verification checklist

---

## Final Goal

The ENTIRE admin dashboard must function as a real-time visual reflection of the LIVE backend billing engine. Every UI section must:
- Dynamically reflect backend logic
- Stay synchronized automatically
- Use centralized calculations
- Validate correctly against live production test keys
- Avoid hardcoded assumptions
- Avoid conflicting economic displays
- Remain consistent across all tabs and analytics
