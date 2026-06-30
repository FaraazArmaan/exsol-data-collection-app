# Booking Module — Phase 2: API (Vendor Config + Public Booking) Implementation Plan

> **STATUS: SCAFFOLDING — decomposition locked; per-task TDD code bodies are being filled in from verbatim POS patterns (explorer in flight). Do not execute until this banner is removed.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the booking module's HTTP layer — vendor configuration/catalog CRUD (build-order C) and the public guest-booking flow up to pay-at-venue confirmation (build-order D) — proven by integration tests plus the concurrency test that demonstrates the no-overbook guarantee end-to-end.

**Architecture:** Flat `netlify/functions/booking-*.ts` (vendor, auth-gated) and `booking-public-*.ts` (anonymous, slug-keyed), mirroring the POS function-per-endpoint + `config.path`/`config.method` pattern. Vendor functions gate on `requireBooking` (mirror of `_pos-authz.requirePos`). Public functions look up the tenant by slug and require no JWT. The public create path does a match-or-create customer `user_node`, then a single `INSERT` whose `gist` constraint makes over-booking impossible — `23P01` maps to HTTP 409. Availability reuses the Phase-1 pure `computeAvailability`, fed by DB rows (settings, resources, time-off, existing bookings) with `date_overrides`/time-off subtracted in the handler.

**Tech Stack:** TypeScript, Netlify Functions v2, `@neondatabase/serverless` (no multi-statement tx), zod, vitest. Phase-1 lib (`src/modules/booking/lib/*`) imported across the `src/` boundary.

## Global Constraints
- Inherits all Phase-1 constraints (strict TS `noUncheckedIndexedAccess`; money = BIGINT cents; `npm run typecheck` before each commit; local commits only, no push/merge).
- **Routing:** flat files only (`feedback_netlify_subdir_function_discovery`); same path + different verb ⇒ separate files discriminated by `config.method` (`feedback_netlify_config_path_method`); `/api/booking/foo/:id` routes to `booking-foo.ts` NOT `booking-foo-detail.ts` (`feedback_netlify_function_name_routing`) — FE must call the literal function path.
- **Permissions:** booking uses ACTION-namespaced keys like POS (`booking.view`, `booking.create`, `booking.edit`, `booking.services.edit`, `booking.resources.edit`, `booking.settings.edit`) — NOT the `booking.<bucket>.<verb>` CRUD form. Declared via a `BOOKING_ACTIONS` const (mirror `POS_ACTIONS`).
- **Module gate:** `requireBooking` must 412 unless `client_enabled_products` has `booking` (and `products` per the `saloon-booking` requires) — pattern from `requirePos`.
- **Error precedence:** permission (401/403) > module-enabled (412) > validation (400) > FSM/conflict (409) — same ordering as POS (`feedback_api_ui_error_precedence`).

## File Structure
```
db/migrations/
  045_booking_customer_dedupe.sql   # user_nodes: customer phone + partial-unique dedupe index   [explorer-dependent]

netlify/functions/
  _booking-authz.ts                 # requireBooking(req, required[]) — mirror _pos-authz
  _booking-validators.ts            # zod bodies: SettingsPut, ServiceCreate/Patch, ResourceCreate/Patch, TimeOff, PublicCreate
  _booking-customer-upsert.ts       # match-or-create customer user_node (normalizePhone + dedupeKey from lib)
  booking-settings.ts               # GET/PUT  /api/booking/settings
  booking-services.ts               # GET/POST /api/booking/services
  booking-service-detail.ts         # GET/PATCH/DELETE /api/booking/service-detail/:id
  booking-resources.ts              # GET/POST /api/booking/resources
  booking-resource-detail.ts        # GET/PATCH/DELETE /api/booking/resource-detail/:id
  booking-resource-time-off.ts      # GET/POST/DELETE /api/booking/resource-time-off
  booking-public-services.ts        # GET /api/booking-public/:slug/services
  booking-public-resources.ts       # GET /api/booking-public/:slug/resources
  booking-public-availability.ts    # GET /api/booking-public/:slug/availability
  booking-public-create.ts          # POST /api/booking-public/:slug/create  (23P01 → 409)

src/modules/registry/
  types.ts                          # + BOOKING_ACTIONS, extend PermissionKey union          [explorer-dependent]
  products-list/saloon-booking.ts   # + permissions[] from BOOKING_ACTIONS                    [explorer-dependent]

tests/booking/
  _helpers.ts                       # extend: enable booking product, grantPerms, request helper, slug
  settings.test.ts  services.test.ts  resources.test.ts  time-off.test.ts
  public-availability.test.ts  public-create.test.ts
  concurrency.test.ts               # 10 parallel POSTs to one slot → exactly one 201, nine 409
```

## Task list (boundaries + interfaces; ordered)

> Order: 1 → 2 → 3 → 4 → (5 ∥ 6 ∥ 7) → 8 → (9 ∥ 10) → 11 → 12 → 13. Tasks 1–4 are the shared foundation; 5–7 are independent vendor CRUD; 9–11 are the public flow; 12 is the concurrency proof; 13 is the green sweep.

- [ ] **Task 1 — Migration 045: customer dedupe** *(explorer-dependent: how "customers bucket" nodes are distinguished + whether `user_nodes` needs a `phone`/`normalized_phone` column)*. Produces the partial-unique index backing the upsert in Task 8. **UNAPPLIED** (same numbering-coordination gate as 043/044).
- [ ] **Task 2 — Registry perms.** Add `BOOKING_ACTIONS` to `types.ts`, extend `PermissionKey`, populate `saloon-booking.ts` `permissions[]` with labels. Unit-test that `derivePermissionRows`/access-levels surfaces the six booking keys. Interface produced: the canonical perm-key strings consumed by `requireBooking` and every handler.
- [ ] **Task 3 — `_booking-authz.ts`.** `requireBooking(req, required: readonly string[]): Promise<{ok:true; ctx:{clientId; userNodeId; perms:Set<string>}} | {ok:false; res:Response}>`. Mirror `requirePos`: `requireBucketUser` → resolve perms → 412 gate on `client_enabled_products` (`booking` + `products`) → 403 on missing required. Consumed by all vendor functions.
- [ ] **Task 4 — `_booking-validators.ts`.** zod schemas (exact `.parse` + 400 error shape from POS): `SettingsPut`, `ServiceCreate`, `ServicePatch`, `ResourceCreate`, `ResourcePatch`, `TimeOffCreate`, `PublicCreateBody`. Consumed by Tasks 5–11.
- [ ] **Task 5 — `booking-settings.ts`** GET/PUT (`config.method` split). Perm `booking.settings.edit` for PUT, `booking.view` for GET. Upserts the single `booking_settings` row; validates `weekly_schedule`/`date_overrides` JSON shape.
- [ ] **Task 6 — `booking-services.ts` + `booking-service-detail.ts`.** CRUD over `booking_services`; enforces deposit-mode invariant (mirrors the DB CHECK) and `eligible_resource_ids` membership. Perm `booking.services.edit` (writes), `booking.view` (reads).
- [ ] **Task 7 — `booking-resources.ts` + `booking-resource-detail.ts` + `booking-resource-time-off.ts`.** CRUD over resources + time-off windows. Perm `booking.resources.edit`.
- [ ] **Task 8 — `_booking-customer-upsert.ts`.** `upsertCustomer(sql, clientId, {name,phone,email}): Promise<{userNodeId; wasCreated}>`. Uses `normalizePhone`/`dedupeKey` (Phase-1 lib); `SELECT … FOR UPDATE`-style match then insert into the customers bucket with `auth_method='none'`. Consumed by Tasks 11 + Phase-3 vendor manual-create.
- [ ] **Task 9 — `booking-public-services.ts` + `booking-public-resources.ts`.** Anonymous; slug→client_id lookup *(explorer item 9: confirm/borrow the public lookup pattern; greenfield if none)*; returns active services / active resources (names only). No JWT.
- [ ] **Task 10 — `booking-public-availability.ts`.** Loads settings/resources/time-off/bookings for the date, subtracts `date_overrides` + time-off into `resources[].busy`, calls `computeAvailability`, then unions ("any") or filters (named) and applies `pickLeastBusy` for the "any" assignment. Returns `{start_utc,end_utc,assignable_resource_id}[]`.
- [ ] **Task 11 — `booking-public-create.ts`.** Validate `PublicCreateBody` → `upsertCustomer` → resolve resource (named or auto-assign) → single `INSERT` into `bookings`. Map `23P01` → `409 slot_taken`. `pay_at_venue` → `status=confirmed` + `manage_token`; `deposit`/`full_upfront` → `status=pending` + `payment_intent` stub (real Razorpay in Phase 3). Lead-time + cutoff enforced here (public), bypassed for vendor manual-create (Phase 3).
- [ ] **Task 12 — `concurrency.test.ts`.** 10 parallel `Promise.all` POSTs to `booking-public-create` for the same slot → assert exactly one 201 and nine 409. The definitive no-overbook proof at the HTTP layer.
- [ ] **Task 13 — Green sweep.** Full `npx vitest run tests/booking src/modules/booking` + `npm run typecheck`; clean tree.

## Self-Review checklist (run after bodies are filled)
- Spec §3 API table: every vendor + public function present? ✓ (Tasks 5–11)
- Availability algorithm consumes Phase-1 `computeAvailability` (no logic duplication)? ✓ (Task 10)
- `23P01 → 409` mapping tested under real concurrency? ✓ (Task 12)
- Perm keys defined once (Task 2) and referenced identically everywhere? (verify when bodies land)
- Deferred to Phase 3: all React UI (public storefront pages, vendor calendar), Razorpay gateway + webhook, magic-link manage, pending-cleanup cron, sidebar nav.

## Status
Decomposition locked. Filling TDD code bodies (Tasks 2–12) from verbatim POS patterns next; Tasks 1 & 2 also depend on the customer-bucket modeling the explorer is confirming.
