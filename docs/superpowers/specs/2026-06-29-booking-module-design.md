# Booking Module — Design Spec

**Date:** 2026-06-29
**Branch:** `feat/booking-module-iso` (Booking chat worktree: `../ExSol-Booking-WT`)
**Scope:** Complete booking system (no staged v1/v2 — ship the full thing). Public guest-checkout storefront + vendor calendar/ops, named resources, per-service payments via Razorpay.
**Sibling chat ownership:** The parallel chat owns `main` / prod / integration. **This chat does not push or merge.** Local commits on the feature branch only.

---

## 1. Goal

A salon/clinic/practice client publishes a public booking page generated from this software. A customer (no login) picks a **service**, a **date**, an **"Any" or named resource** (stylist/room/doctor), and a **time slot**; fills name + phone + email; optionally pays (per the service's payment mode); and gets a confirmation with a magic-link to manage/cancel. The vendor sees every booking on a day-view calendar, can create bookings manually (off-grid, bypassing lead-time/cutoff), block staff-only time, and run the service catalog, resources, and schedule settings.

The hard guarantee: **no over-booking**, enforced atomically in Postgres so two simultaneous customers cannot both win the same resource+time.

### Design forks resolved (brainstorming)

| # | Question | Decision |
|---|---|---|
| Q1 | How is slot length decided? | **D → fixed grid** (vendor sets `slot_interval_min`); vendor side can book off-grid arbitrary ranges. |
| Q2 | Can one booking span multiple cells? | **B → service catalog**; a service has a duration that spans N consecutive cells. |
| Q3 | How are business hours defined? | Per-weekday schedule **+ date overrides** (holidays). |
| Q4 | Public link or signed-in? | **Public guest checkout**, evolved: server **auto match-or-creates** a customer user-node (real FK), claimable via magic-link. |
| Q5 (re-opened) | Abstract capacity vs named resources? | **Named resources** with per-resource schedules + time-off (the project ships complete, not MVP). |
| Q6 | Payment flow | **D → per-service `payment_mode`** (`pay_at_venue` / `deposit` / `full_upfront`); **Razorpay** real gateway + webhook. |
| Q7 | Resource picker UX | **C → "Any [resource]" OR a named one.** "Any" auto-assigns the resource with the **fewest bookings that day**, tie-broken by `resource.id` (deterministic). |
| §4-a | Calendar default | **Day-view** (vertical timeline per resource). |
| §4-b | Manual booking w/o customer? | Yes — dedicated **`status = 'blocked'`** (staff lunch/vacation/supplier); counts toward overlap, excluded from revenue reports. |

### Locked defaults (industry-standard, no fork)

- Customer dedupe key: `(tenant_id, normalized_phone, lower(email))` — Fresha-style, zero false-merges.
- Buffer between bookings: per-service, default 0 min.
- Lead time: per-tenant min-minutes-before-now, default 0.
- Cancellation: customer may cancel until a vendor-configured cutoff; reschedule = cancel + rebook (no dedicated FSM transition).
- Vendor manual booking bypasses lead-time + cutoff.
- Tenant timezone: read from `clients` row (add column); all grid math in tenant-local, **stored as UTC**.

---

## 2. Data Model

> **No-overbooking guarantee** lives in Postgres, not the API layer: an `EXCLUDE USING gist` constraint on a `tstzrange` per resource catches overlap at *any* granularity (so vendor manual bookings can drift off the grid safely). There is deliberately **no `slots` table** — availability is computed on-read from `(booking_settings, date_overrides, resource schedule, time_off, existing bookings)`. Storing slot rows would double-write the truth (Calendly/Fresha both compute on read).

New tables (migrations ~043+, next available):

| Table | Purpose | Key columns |
|---|---|---|
| `clients` (alter) | Tenant timezone | `+ timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata'` |
| `booking_settings` | One row per tenant | `bucket_id PK`, `slot_interval_min`, `lead_time_min`, `cancel_cutoff_min`, `weekly_schedule JSONB` (Mon–Sun open/close), `date_overrides JSONB` (holidays) |
| `booking_resources` | Named staff/rooms | `id`, `bucket_id`, `name`, `weekly_schedule JSONB`, `active BOOLEAN` |
| `booking_resource_time_off` | Per-resource one-off blocks | `id`, `resource_id`, `starts_at`, `ends_at`, `reason` |
| `booking_services` | Vendor catalog | `id`, `bucket_id`, `name`, `duration_min`, `price_cents`, `payment_mode` enum (`pay_at_venue`/`deposit`/`full_upfront`), `deposit_cents`, `buffer_min`, `active`, `eligible_resource_ids UUID[]` |
| `bookings` | The booking row | `id`, `bucket_id`, `service_id`, `resource_id NOT NULL`, `user_node_id NOT NULL`, `time_range TSTZRANGE`, `status` enum, `customer_name/phone/email` snapshot, `price_cents`, `deposit_paid_cents`, `cancellation_reason`, `cancelled_at`, `manage_token`, `created_by_user_node` (vendor) or NULL (self-serve), timestamps |

**Constraints**
- `EXCLUDE USING gist (resource_id WITH =, time_range WITH &&) WHERE (status IN ('pending','confirmed'))` — atomic no-overlap per resource. (Note: `blocked` is also non-cancelled and must occupy time — see §5 status semantics; include it in the predicate alongside pending/confirmed.)
- `bookings.user_node_id` FK → `user_nodes(id)` (auto-created customer node).
- Customer dedupe: partial unique on `user_nodes (bucket_id, lower(email), normalized_phone) WHERE bucket_key = 'customers'`.

> **FK follow-up:** mirror the `created_by_user_node` ON DELETE concern tracked in `project_team_fk_on_delete_followup.md` — deleting a vendor node should not 500 a booking row.

---

## 3. API Surface

Flat function-per-endpoint files under `netlify/functions/` (no subdirs — durable memory flags subdir discovery as broken; see `feedback_netlify_subdir_function_discovery.md`). Disambiguate shared paths with `config.method` (`feedback_netlify_config_path_method.md`).

### Vendor-side (auth-gated by `permissions[<key>]`)

| Function file | Method · Path | Purpose | Perm |
|---|---|---|---|
| `booking-settings.ts` | GET/PUT `/api/booking/settings` | Tenant grid / lead-time / cutoff / weekly-schedule / overrides | `booking.employees.edit` |
| `booking-resources.ts` | GET/POST `/api/booking/resources` | List + create resources | `booking.employees.edit` |
| `booking-resource-detail.ts` | GET/PATCH/DELETE `/api/booking/resource-detail/:id` | Rename / schedule / deactivate | `booking.employees.edit` |
| `booking-resource-time-off.ts` | GET/POST/DELETE `/api/booking/resource-time-off` | Add/remove time-off | `booking.employees.edit` |
| `booking-services.ts` | GET/POST `/api/booking/services` | List + create services | `booking.employees.edit` |
| `booking-service-detail.ts` | GET/PATCH/DELETE `/api/booking/service-detail/:id` | Per-service edit | `booking.employees.edit` |
| `booking-list.ts` | GET `/api/booking/list?from=&to=&status=&resource_id=` | Vendor calendar/list view | `booking.customers.view` |
| `booking-detail.ts` | GET/PATCH `/api/booking/detail/:id` | Read one + state transitions (completed/no_show/vendor cancel) | `booking.customers.edit` |
| `booking-manual-create.ts` | POST `/api/booking/manual-create` | Vendor creates on behalf of customer; bypasses lead-time + cutoff; same match-or-create node logic | `booking.customers.create` |

### Customer / public-side (no auth for browse + create)

| Function file | Method · Path | Purpose |
|---|---|---|
| `booking-public-services.ts` | GET `/api/booking-public/:slug/services` | Public service catalog |
| `booking-public-resources.ts` | GET `/api/booking-public/:slug/resources` | Active resources (name only) |
| `booking-public-availability.ts` | GET `/api/booking-public/:slug/availability?service_id=&date=&resource_id=any\|<id>` | Returns `{start, end, assignable_resource_id}[]` for the date |
| `booking-public-create.ts` | POST `/api/booking-public/:slug/create` | `{service_id, resource_id\|"any", start, customer:{name,phone,email}}` → match-or-create node → INSERT in a tx (gist = atomic) → returns `manage_token`; if `payment_mode != pay_at_venue`, returns `payment_intent` |
| `booking-public-manage.ts` | GET/POST `/api/booking-public/manage/:token` | Magic-link view/cancel (no login). POST `{action:'cancel'}` |

### Customer upsert helper — `_booking-customer-upsert.ts`
The only place a `user_node` is created. 1) normalize phone (E.164) + lowercase email; 2) `SELECT … FOR UPDATE` on the match; 3) hit → reuse node, miss → INSERT into `customers` bucket with `auth_method='none'` (claimable via magic-link); 4) return `(user_node_id, was_created)`.

### Availability algorithm (the hot path)
```
inputs: bucket_id, service_id, date (tenant-local), resource_id | "any"

1. Load booking_settings, service, resources (∩ service.eligible_resource_ids),
   time_off covering date, bookings for date+1day window.
2. Per candidate resource:
   a. open windows = resource.weekly_schedule ∩ tenant weekly
      ∩ NOT date_overrides ∩ NOT time_off
   b. walk the day in slot_interval_min steps from open
   c. candidate_range = [start, start + duration_min + buffer_min)
      free iff: range fully inside an open window
              AND no existing booking overlaps for this resource
              AND start >= now + lead_time_min
3. resource_id == "any": union across resources (de-dupe by start),
   record least-busy-that-day for tiebreak.
   resource_id == <id>: filter to that resource.
4. return {start_utc, end_utc, assignable_resource_id}[]
```
Cached in-function 30s per `(bucket, service, date)`. Cache busts on any `booking_*` POST/PATCH via a per-tenant version counter in Netlify Blobs (existing cache pattern — note `feedback_netlify_functions_no_shared_memory.md`: no module-level Map).

---

## 4. Customer-Side UX (public storefront)

Route `/c/:slug/book` (anonymous; mounts skip `useUserAuth`). Lives in `src/modules/booking/public/`.

```
Step 1  /c/:slug/book                       → ServicePickerPage
        Tiles: name, duration, price, payment-mode chip (none if pay_at_venue)

Step 2  /c/:slug/book/:serviceId            → SlotPickerPage
        - DatePicker (next 60 days; disables zero-availability dates)
        - Resource toggle: "Any [stylist]" | named resources
        - Time grid: slot cells as scrollable rows of pills
          available = clickable "9:15 AM"; taken/closed = greyed
        - Polls /availability every 30s (matches cache TTL)

Step 3  /c/:slug/book/:serviceId/:startIso  → CheckoutPage
        - Summary: service, date, time, resource, price
        - Form: name, phone, email (prefilled from localStorage)
        - Consent checkbox + "Confirm booking"
        - pay_at_venue   → POST /create → confirmed → ConfirmationPage
          deposit/full   → POST /create → pending + payment_intent
                          → inline Razorpay PaymentStep
                          → gateway success → server flips to confirmed
                          → ConfirmationPage

Step 4  /c/:slug/book/done/:manageToken     → ConfirmationPage
        - Check + summary; "magic link emailed to <email>"
        - "Add to Google Calendar" (ICS) | "Book another"

Manage   /c/book/manage/:token              → ManageBookingPage
        - tenant-agnostic URL (token carries bucket_id)
        - booking + countdown to cutoff; "Cancel" → cancelled, slot reopens
```

Polling stops after the slot picker — the gist constraint rejects a sniped create, and the UI surfaces "this slot was just taken, pick another."

---

## 5. Vendor-Side UX, Lifecycle & Payments

Routes `/c/:slug/booking/*`, mounted via `BookingRouteMounts.tsx` (mirrors `PosRouteMounts`). Lives in `src/modules/booking/vendor/`.

| Route | Page | Perm |
|---|---|---|
| `/c/:slug/booking` | **CalendarPage** — **day-view** default; columns = resources, rows = time. Empty cell → manual-booking drawer; filled → BookingDetailDrawer. | `booking.customers.view` |
| `/c/:slug/booking/list` | **BookingsListPage** — filter by status/resource/date, search by phone (mirrors `SalesListPage`) | `booking.customers.view` |
| `/c/:slug/booking/services` | **ServicesPage** — catalog CRUD | `booking.employees.edit` |
| `/c/:slug/booking/resources` | **ResourcesPage** — resource CRUD + weekly schedule + time-off | `booking.employees.edit` |
| `/c/:slug/booking/settings` | **SettingsPage** — interval, weekly schedule + date overrides, lead time, cutoff, timezone | `booking.employees.edit` |

**Manual booking drawer** (from any empty cell): same form as customer checkout, but vendor may override start to any minute (off-grid; gist still guards), skip lead-time + cutoff, and mark as already-paid (bypass gateway). A **blocked-time** option creates `status='blocked'` with no customer.

**Sidebar nav** entry in `src/modules/user-portal/nav/`, gated by `booking.customers.view`.

**Permission keys** — booking uses the platform's **bucket×verb model** (`<module>.<bucket>.<verb>`) so keys validate via `isValidPermissionKey` and render/toggle in the access-levels UI today (the action-namespaced form like `booking.settings.edit` is rejected by the validator — same gap POS carries). Mapping:
- `booking.customers.view` — see bookings / calendar / availability list
- `booking.customers.create` — create bookings (vendor manual-create; public path is anonymous)
- `booking.customers.edit` — edit / state-transition / cancel bookings
- `booking.employees.view` — view resources
- `booking.employees.edit` — manage services, resources, time-off, and settings

The `booking` module is enabled via the `saloon-booking` product; `requireBooking` gates on the **booking module** being reachable from any enabled product (not a hardcoded product key).

> Post-deploy gap from POS still open: action-namespace perms need admin-UI surfacing. Confirm these keys render in the access-levels editor.

### Status FSM (`_booking-fsm.ts`, mirrors `_pos-fsm.ts`)
```
pending     created, awaiting payment (deposit/full_upfront only)
confirmed   ready (instant if pay_at_venue; after gateway success otherwise)
blocked     vendor-only time block, no customer
completed   vendor marked done after the appointment
cancelled   customer/vendor cancelled (records cancellation_reason)
no_show     vendor marked no-show after window passed

pending ──pay──▶ confirmed ──do──▶ completed
   │                │
   │                ├──cancel(any)──▶ cancelled
   │                └──vendor mark──▶ no_show
   └──cancel/timeout──▶ cancelled
blocked ──vendor unblock──▶ hard delete
```
Auto-rules (server-enforced):
- `pending` > 15 min with no payment → cron flips to `cancelled` (frees slot). Netlify scheduled function (`[functions.<name>.schedule]`).
- Customer cancel only when `now < starts_at - cancel_cutoff_min`; vendor cancel any time.
- `completed`/`no_show` only when `now > starts_at + duration_min`.

### Payments — Razorpay (baked in)
Real gateway + real webhook. `deposit`/`full_upfront` services create `pending` + a Razorpay payment intent; the webhook function verifies signature and flips `pending → confirmed`, recording `deposit_paid_cents`. `pay_at_venue` confirms instantly (cash handled by POS).

---

## 6. Testing Strategy & Build Order

| Layer | Tool | Coverage |
|---|---|---|
| Unit | `vitest` in `src/modules/booking/lib/__tests__/` | availability algorithm, FSM, phone normalization, dedupe-key, timezone/DST (spring-forward/fall-back), least-busy tiebreak |
| Integration | `vitest` in `tests/integration/booking/` (real Postgres) | handlers e2e: gist rejects overlap, match-or-create node, manual bypasses lead-time, pending-cleanup cron, Razorpay webhook flip, magic-link cancel |
| **Concurrency** | dedicated | 10 parallel `Promise.all` POSTs to one slot → **exactly one 201, nine 409**. The only test that proves no-overbook. **Mandatory.** |
| Round-trip smoke | mirror POS round-trip | settings → resource → service → availability → public create → vendor confirm → mark completed |

Threshold: ≥ 1 integration test per netlify function. **Implementer must run `npm run typecheck`** (runtime checks don't validate TS — `feedback_implementer_verify_typecheck.md`).

### Feature-area build order
```
A. DB foundation              [migrations 043+]  tenant TZ, settings, services,
                              resources, time_off, bookings (+ gist EXCLUDE), dedupe index
B. Shared lib                 [src/modules/booking/lib/] availability, fsm, validators,
                              dedupe, tz, auto-assign — full unit coverage
C. Vendor settings + catalog  [settings, services CRUD, resources CRUD + time-off]
D. Public availability+create [public services/resources/availability/create]
E. Public checkout + payments [Razorpay client, payment-intent, webhook, FE Checkout, Confirmation]
F. Customer manage flow       [magic-link manage fn + page, cancel]
G. Vendor calendar + ops      [day-view calendar, manual-create drawer, detail drawer,
                              transitions, blocked-time UI]
H. Cron + cleanup             [pending-cleanup scheduled function]
I. Sidebar nav + perms + access-levels seeding
J. Round-trip + concurrency + smoke tests
```
Order: **A → B → (C ∥ D) → E → F → G → H → I → J.** ~9–11 task buckets → 3–6 atomic tasks each under `writing-plans`.

### Deploy preflight (durable rules)
- Prod migrations 043+ run against **prod** Neon URL **before** promoting code (`feedback_migration_before_deploy.md`); verify endpoint host before any destructive psql (`feedback_verify_neon_endpoint_before_drop.md`).
- Netlify 4-item checklist: NPM_FLAGS + external_node_modules + env coverage + per-context DATABASE_URL (`feedback_netlify_deploy_checklist.md`). Razorpay keys are new env vars — add to all contexts.
- No deploy previews; no push without explicit approval (`feedback_no_deploy_previews.md`, `feedback_no_push_without_approval.md`).
- Probe each new function endpoint post-push; `restoreSiteDeploy` if Edge 404s (`feedback_netlify_new_function_404.md`).

---

## Status

**Brainstorming complete; all forks locked.** Next: `writing-plans` → ordered task list → `to-issues`, then implement A→J in this worktree (`feat/booking-module-iso`).
