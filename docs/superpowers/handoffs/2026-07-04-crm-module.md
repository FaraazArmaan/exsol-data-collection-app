# Handoff — CRM Module v1 (2026-07-04)

## ═══════ STATUS: COMPLETE — ready for integration cherry-pick ═══════

CRM module v1 is **built, fully tested, and green** on branch `feat/crm-iso` in worktree
`../ExSol-Booking-WT`. **Local commits only — never pushed.** The Main integration chat should
cherry-pick the CRM commits onto `main`.

- **HEAD:** `807f6bf`  | **merge-base with main:** `6b73b43`
- **Done gate (all green):** `tsc --noEmit` zero errors · **vitest 1105/1105 passed** (182 files) ·
  `vite build` ✓ (only the pre-existing advisory chunk-size warning).
- **15 CRM commits** (`f7b2ed9` … `807f6bf`), each implemented TDD and reviewed (spec + quality)
  by a separate agent; 3 review-driven fixes applied (dedupe-key stability, sidebar className,
  note-CRUD error handling).

## What it is

A **derived customer read-model** unifying customers across POS `sales` + Booking, with a vendor
UI at `/c/:slug/crm`: searchable customer list, detail page with a live activity timeline (their
sales + bookings) and notes CRUD. No parallel source of truth — `user_nodes` stays untouched.

**Design/plan:** `docs/superpowers/specs/2026-07-03-crm-module-design.md`,
`docs/superpowers/plans/2026-07-03-crm-module.md`.

## Migration

- **`db/migrations/055_crm.sql`** — `crm_customers` (unique `(client_id, dedupe_key)`) + `crm_notes`.
- `055` is the reserved CRM number; on current `main` the slot is FREE (main has 052–054, 056–057
  from sibling chats; not 055). This branch was cut before those landed, so it does NOT contain
  052–054/056–057 — that's expected; cherry-picking the CRM commits adds only `055`.
- **Prod:** run `npm run migrate` against the prod DATABASE_URL BEFORE deploying CRM code
  (migrate applies files individually; the 051-gap is fine). Dev already has 055 applied.

## New Netlify functions (flat files) + routes

| File | Route | Method | Perm |
|---|---|---|---|
| `crm-refresh.ts` | `/api/crm/refresh` | POST | `crm.customers.view` |
| `crm-customers-list.ts` | `/api/crm/customers` | GET | `crm.customers.view` |
| `crm-customer-detail.ts` | `/api/crm/customers/:id` | GET | `crm.customers.view` |
| `crm-notes.ts` | `/api/crm/notes` | POST | `crm.customers.create` |
| `crm-note-detail.ts` | `/api/crm/notes/:id` | PATCH / DELETE | `crm.customers.edit` / `.delete` |
| `_crm-authz.ts` | (helper) | — | enable-gate + `level_number===1` bypass, mirrors `_booking-authz.ts` |

Shared pure logic: `src/modules/crm/lib/{merge.ts, refresh.ts}` (`refreshCustomers` is reused by the
endpoint AND the seed script). FE under `src/modules/crm/` mirrors Booking.

## Registry + enablement

- `crm` ModuleManifest (`manifests/crm.ts`) + `crm` ProductManifest (`products-list/crm.ts`),
  registered in `modules.ts` / `products.ts`. Perms are bucket×verb `crm.customers.{view,create,edit,delete}`.
- **A tenant only sees CRM if the `crm` product is in its `client_enabled_products`.** `npm run seed:crm`
  enables it for `papa-s-saloon` on dev (and backfills — seeded 1 customer). For prod tenants, enable
  via product management (or an equivalent insert) as part of rollout.

## Env vars

**None new.** CRM uses the existing `DATABASE_URL`. No external services, no secrets.

## Sync model (important)

Refresh-on-load: `POST /api/crm/refresh` materializes `crm_customers` from `user_nodes` (role
`bucket_family='customers'`) + paid `sales` (`status IN ('paid','fulfilled')`), deduped by a
**phone-canonical** key (`phone:<e164>` when a phone exists, else `email:<lower>`) — stable across
refreshes so the DB upsert never duplicates a customer. The list page calls refresh on mount + a
manual Refresh button. **Zero edits to POS/Booking handlers** (avoids cross-module cherry-pick
conflicts) — Booking already creates the `user_nodes` customer, so the golden flow works for free.

## Gotchas / decisions

- **Timeline identity match** bridges normalized-vs-raw phone: `crm_customers.phone` is normalized
  (+91…) but `sales`/`bookings` store the raw entered phone, so the timeline matches on the LAST 10
  DIGITS (`right(regexp_replace(...,'[^0-9]','','g'),10)`) OR lowercased email. Do not change to
  exact equality.
- **L1 Owner bypass** present in `_crm-authz.ts`, `Sidebar.tsx`, and `CrmRouteMounts.tsx` (the
  systemic gap that shipped wrong on POS/Booking — verified here).
- Notes CRUD maps onto the `customers` bucket verbs (create/edit/delete); reading uses `view`.

## Cross-cutting flags for the integration chat

1. **Authz `client_id` (defense-in-depth, NOT a CRM regression):** `_crm-authz.ts` mirrors
   `_booking-authz.ts` — the enable-gate uses the JWT `claims.client_id`, and `permRows` pins by
   `user_node_id`. Not exploitable (sessions are signed), but a platform-wide hardening pass could add
   `AND un.client_id = claims.client_id` to the perm query in BOTH authz files.
2. **The "8 analytics/recharts typecheck errors" were an ENV artifact** of this worktree's incomplete
   `node_modules` (missing type deps incl. `@fontsource-variable/inter`). After `npm install`, typecheck
   AND `npm run build` are fully green. Main's build was never actually broken by CRM. If a fresh
   worktree shows those errors, run `npm install`.

## Optional polish (Minor review findings — none block merge)

- `merge.ts:135` redundant `phone ?? null`; `merge.test.ts` could assert the exact `dedupe_key` value.
- `crm-customer-detail.ts` `SELECT *` → could list columns; T7 handlers `.trim()` twice; T7 notes
  test lacks negative-path cases; T10 `.error` styling subtle + no in-flight search indicator;
  T11 `.pm-empty` unstyled standalone (visible plain text).

## Verification note

Backend golden flow (guest booking → customer appears via refresh → timeline → notes) is proven by
the CRM integration tests (`tests/crm/*`: refresh dedup+idempotency, detail timeline via the phone
bridge, notes create/edit/delete, authz 401/412/403/L1). FE is build-verified. A manual browser smoke
via `netlify dev --port 5182 --target-port 8892` is recommended before prod but was not run headlessly.
