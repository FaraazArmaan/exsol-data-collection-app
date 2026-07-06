# CRM Module v1 — Design Spec (2026-07-03)

Status: **approved for planning**. Isolated build in worktree `../ExSol-Booking-WT` on branch
`feat/crm-iso` (off `main`). Local commits only — the Main integration chat cherry-picks. Ports for
`netlify dev`: **5182 / 8892**.

## 1. Purpose & scope

A **money-legible unified customer view**. CRM v1 is a WIDTH SLICE: shallow but real, no dead ends,
survives a free-clicking reviewer (every state handled, realistic seeded demo data). It is a
**derived read-model** over data that already exists — it does NOT become a competing source of truth.

Reserved migration number: **055** (051–054 are reserved for sibling chats Payments/Email/Inventory/
Finance and do not exist yet; the migrate runner must tolerate the gap on dev).

### In scope
- `crm_customers` + `crm_notes` tables (migration 055).
- Idempotent **refresh** that materializes customers from the two existing sources
  (`user_nodes` customers + `sales` plain customer columns), deduped by phone+email.
- Vendor UI at `/c/:slug/crm`: customer **list + search**; **detail** page with a **live activity
  timeline** (their sales + bookings) and **notes CRUD**.
- Registry (ModuleManifest + a CRM ProductManifest), `_crm-authz.ts`, sidebar + route mounts.
- `scripts/seed-crm.ts` producing realistic demo data for `papa-s-saloon`.
- Tests (pure merge unit + DB-backed integration) and the golden-flow smoke.

### Explicitly OUT of scope (v1)
Manual customer create / identity-merge / edit-identity; CSV export; communication/message log;
scale or performance tuning of refresh; P&L / revenue reporting (that is the separate Finance module).
Notes are the ONLY writable customer data.

### Golden flow
Make a booking as a guest → open CRM → the customer appears → add a note.

## 2. Why a read-model (not a new customer store)

`user_nodes` is already the canonical customer store — `docs/architecture.html:522` explicitly calls it
"the CRM seed", and Booking's `booking-public-create` already auto-creates a `user_nodes` customer via
`upsertCustomer`. POS `sales` instead carry **plain** `customer_name/phone/email` columns with **no FK**
(intentional, per `architecture-expansive.html:1377`: "Future CRM integration can match-or-link these
post-hoc"). CRM v1 does exactly that post-hoc match-or-link, without editing any POS/Booking handler —
which also keeps this isolated branch free of cross-module edits that would risk cherry-pick conflicts
with the sibling Payments/Booking chats.

## 3. Sync mechanism — refresh-on-load (chosen)

A dedicated idempotent `POST /api/crm/refresh` upserts `crm_customers`. The CRM list page calls it on
mount (plus a manual "Refresh" button); `GET` endpoints stay pure reads. Backfill of history is the
same code path, also invoked by the seed script.

Rejected alternatives:
- **Create-handler hooks** (a `_crm-sync.ts` called from `pos-sale-create`/`pub-sale-create`/
  `booking-public-create`): spec-literal but edits 3 cross-module files → cherry-pick conflict risk +
  silent drift.
- **Live SQL VIEW, no persisted customer table**: cleanest data model but diverges from the spec's
  literal `crm_customers` table and makes notes attach by text key instead of a stable FK.

## 4. Data model — migration `055_crm.sql`

```
crm_customers
  id            UUID PK  default gen_random_uuid()
  client_id     UUID NOT NULL  → public.clients(id) ON DELETE CASCADE
  display_name  TEXT NOT NULL
  phone         TEXT            -- normalized (normalizePhone), nullable
  email         TEXT            -- lower(email), nullable
  dedupe_key    TEXT NOT NULL   -- `${phone ?? ''}|${lower(email) ?? ''}` (dedupeKey from dedupe.ts)
  source        TEXT NOT NULL CHECK (source IN ('pos','storefront','booking'))  -- first-seen origin
  first_seen    TIMESTAMPTZ NOT NULL
  last_seen     TIMESTAMPTZ NOT NULL
  created_at    TIMESTAMPTZ NOT NULL default now()
  updated_at    TIMESTAMPTZ NOT NULL default now()
  UNIQUE (client_id, dedupe_key)

crm_notes
  id                    UUID PK  default gen_random_uuid()
  client_id             UUID NOT NULL  → public.clients(id) ON DELETE CASCADE
  customer_id           UUID NOT NULL  → public.crm_customers(id) ON DELETE CASCADE
  body                  TEXT NOT NULL
  created_by_user_node  UUID           → public.user_nodes(id) ON DELETE SET NULL
  created_at            TIMESTAMPTZ NOT NULL default now()
  updated_at            TIMESTAMPTZ NOT NULL default now()
```

Design notes:
- **`dedupe_key`, not a raw `(phone,email)` unique.** Postgres treats NULL ≠ NULL, so two rows with the
  same phone and NULL email would both insert. A single computed key sidesteps that and makes
  "unique per client on phone+email" actually hold. It also gives `crm_notes` a **stable FK across
  refreshes** (upsert is `ON CONFLICT (client_id, dedupe_key) DO UPDATE`, so ids never churn).
- SQL style: one statement per line; comments on their own line, never after a `;`
  (`feedback_migrate_splitter_inline_comment`). Follow the lowercase + `if not exists` idempotent style
  of migrations 045/050. Header comment block cites this spec and the reservation.

## 5. Refresh logic (the heart — a testable pure unit)

`crm-refresh.ts` (`POST /api/crm/refresh`, `requireCrm(['crm.customers.view'])`):

1. Query A — customers from `user_nodes` where their role has `bucket_family='customers'`, LEFT JOIN
   `bookings ON bookings.user_node_id` (GROUP BY node) → `{display_name, phone, email, un.created_at,
   min(booking.created_at), max(booking.created_at)}`.
2. Query B — `DISTINCT` identities from `sales` where `bucket_id = client AND status IN
   ('paid','fulfilled')`, GROUP BY raw identity → `{customer_name, customer_phone, customer_email,
   source(=storefront if source='storefront' else pos), min(created_at), max(created_at)}`.
3. **Merge in TypeScript** via `src/modules/crm/lib/merge.ts` — a pure `mergeCustomers(rows) →
   MergedCustomer[]`, reusing `normalizePhone` and `dedupeKey` from
   `src/modules/booking/lib/dedupe.ts` **verbatim** (no SQL re-encoding — that would let the CRM key
   drift from Booking's and split one person into two rows). Merge rules: group by `dedupe_key`;
   `first_seen = MIN`, `last_seen = MAX`; prefer a non-empty `display_name`; keep the earliest
   `source`. **Skip** rows whose `dedupe_key` is empty (no phone AND no email).
4. Upsert each merged customer: `INSERT ... ON CONFLICT (client_id, dedupe_key) DO UPDATE SET
   display_name, phone, email, last_seen = GREATEST(existing, new), first_seen = LEAST(existing, new),
   updated_at = now()` (source is kept on conflict). Return `{ synced: n }`.

Neon HTTP driver has no easy multi-statement transaction; per-row upserts are the same consistency
class as existing `sale_lines` inserts and are idempotent.

## 6. Endpoints (flat `netlify/functions/crm-*.ts`, each gated by `requireCrm`)

| File | `config.path` | method | required perm |
|---|---|---|---|
| `crm-refresh.ts` | `/api/crm/refresh` | POST | `crm.customers.view` |
| `crm-customers-list.ts` | `/api/crm/customers` | GET | `crm.customers.view` |
| `crm-customer-detail.ts` | `/api/crm/customers/:id` | GET | `crm.customers.view` |
| `crm-notes.ts` | `/api/crm/notes` | POST | `crm.customers.create` |
| `crm-note-detail.ts` | `/api/crm/notes/:id` | PATCH, DELETE | `crm.customers.edit` / `crm.customers.delete` |

- **List**: `?q=` filters `display_name`/`phone`/`email` (ILIKE), `ORDER BY last_seen DESC`.
- **Detail** returns `{ customer, notes, timeline }`. `timeline` is queried **live**: their `sales`
  (`status IN ('paid','fulfilled')`, matched by phone/email identity) + their `bookings` (matched by
  `user_node_id` OR identity), normalized to `{ kind:'sale'|'booking', id, when, label, amount_cents,
  status }`, merged and sorted desc.
- No path collisions: `/customers`, `/customers/:id`, `/notes`, `/notes/:id`, `/refresh` are all
  distinct (no literal sub-path nested under a `:param` route — `feedback_netlify_routing`).
- Two functions sharing a `config.path` must both set `config.method` — not needed here (all distinct),
  but the `PATCH`/`DELETE` pair lives in one file with `method: ['PATCH','DELETE']`.

## 7. Registry + authz

- `src/modules/registry/manifests/crm.ts`:
  `{ key:'crm', label:'CRM', data_buckets:['customers'], verbs:['view','create','edit','delete'],
  vendor_side:true, customer_side:false }`; register one line in `registry/modules.ts`.
- **`src/modules/registry/products-list/crm.ts`** — a new `crm` ProductManifest referencing the module
  (`modules:[{ module:'crm', side:'vendor' }]`); register in `registry/products.ts`. A ModuleManifest
  with no ProductManifest is invisible and its keys never validate
  (`feedback_module_needs_product_manifest`).
- The demo tenant must have the `crm` product in `client_enabled_products` — the **seed script inserts
  it** for `papa-s-saloon` (idempotent). Real tenants enable via product management.
- `netlify/functions/_crm-authz.ts` — clone `_booking-authz.ts`:
  `requireCrm`, `CrmAuthCtx`, `ALL_CRM_PERMS = ['crm.customers.view','crm.customers.create',
  'crm.customers.edit','crm.customers.delete']`, enable-gate `modules.has('crm')` → 412
  `crm_module_not_enabled`, then **`level_number === 1` Owner bypass** (full perm set), then the
  `required` loop → 403 `missing_permission`. Missing L1 bypass has shipped wrong twice
  (`feedback_module_l1_bypass_pattern`) — verify it in authz AND Sidebar AND RouteMount.

Permission keys are **bucket×verb only** (`crm.customers.<verb>`); never action-namespaced
(`feedback_permission_keys_bucket_verb_only`). Notes CRUD maps onto the `customers` bucket verbs
(create/edit/delete); reading (list/detail/timeline) uses `view`.

## 8. Frontend (`src/modules/crm/`, mirrors Booking)

- `api.ts` — `CrmApiError` + throw-on-error `call<T>` + `crmApi` (`refresh`, `listCustomers(q)`,
  `getCustomer(id)`, `addNote(customerId, body)`, `editNote(id, body)`, `deleteNote(id)`) + colocated
  types (`CrmCustomer`, `CrmNote`, `TimelineEvent`).
- `format.ts` (copy `booking/format.ts` money/date helpers); `shared/permissions.ts` (copy
  `products/shared/permissions.ts` → `canViewCrm`, etc.).
- `CrmRouteMounts.tsx` — `gate()` factory + `ALL_CRM_PERMS` + L1 bypass (`level_number == null || === 1`).
  Exports `CrmListMount`, `CrmDetailMount`.
- `vendor/CustomersListPage.tsx` — **calls `refresh()` on mount** then `listCustomers()`; `.pm-search`
  box; `.pm-table` (name / phone / email / last_seen); row → `/c/:slug/crm/:id`; manual **Refresh**
  button; **empty / loading / error** states all handled.
- `vendor/CustomerDetailPage.tsx` — header (name/phone/email/source/first+last seen); live **activity
  timeline**; **notes** list + add/edit/delete forms gated by `perms.has('crm.customers.<verb>')`;
  empty/loading/error.
- `.crm-*` CSS block appended to `src/lib/components.css` (reuse `.page`, `.pm-table`, `.pm-search`,
  `.muted`, `.btn`, `.booking-drawer` conventions).
- Wire-up: `src/lib/router.tsx` (`{ path:'crm', element:<CrmListMount/> }`,
  `{ path:'crm/:id', element:<CrmDetailMount/> }`, imports near booking's);
  `src/modules/user-portal/nav/useNavItems.ts` (add `'crm'` to `MODULES_WITH_DEDICATED_NAV`);
  `src/modules/user-portal/layout/Sidebar.tsx` (`crmEnabled` + `showCrm = crmEnabled && (isOwner ||
  permissions['crm.customers.view'] === true)` + NavLink to `/c/:slug/crm` + include in the group guard).

## 9. Seed, tests, verification

- `scripts/seed-crm.ts` + `"seed:crm"` in package.json — direct `neon(DATABASE_URL)`; resolve
  `papa-s-saloon` by slug; ensure the `crm` product is enabled (`client_enabled_products` upsert); then
  **run the refresh code path** so the list is populated from whatever POS/Booking demo data exists.
  (Refresh being the backfill means seed and forward-sync can never disagree.)
- Tests:
  - `src/modules/crm/lib/__tests__/merge.test.ts` — pure: dedupe by key, first/last-seen min/max,
    source precedence, empty-key skip, phone/email normalization. No DB.
  - `tests/crm/*` (helpers from `tests/booking/_helpers.ts`) — DB-backed: refresh upsert +
    idempotency + cross-source dedupe (same person via POS + booking → 1 row); list + `?q=` search;
    detail timeline (sale + booking present, correct order); notes create/edit/delete; authz
    (401 unauthenticated / 412 module-disabled / 403 missing-perm / L1 bypass grants all).
  - CRM touches **no Blobs** → no `getStore()` mock needed. Randomize unique-constrained literals
    (phones/emails) — shared persistent dev DB, no teardown (`feedback_tests_share_persistent_dev_db`).
- **Done gate** (`CLAUDE.md`): `npm run typecheck` AND the FULL vitest suite green. Then golden-flow
  smoke via `netlify dev --port 5182 --target-port 8892`.

## 10. Platform-pattern checklist (each has burned us before)

- [ ] Migration uses reserved **055**; one statement per line; no inline comment after `;`.
- [ ] ModuleManifest **and** a ProductManifest entry; product enabled for the demo tenant.
- [ ] Permission keys bucket×verb only (`crm.customers.<verb>`).
- [ ] `_crm-authz.ts` enable-gate + `level_number===1` bypass; same bypass in Sidebar + RouteMount.
- [ ] Netlify functions flat top-level; distinct `config.path` (method array only where a path is shared).
- [ ] FE mirrors Booking: shared types + throw-error API layer + perms in a shared dir; `.crm-*` CSS.
- [ ] Tests: randomize unique literals; full suite green; no Blobs → no getStore mock.
- [ ] `scripts/seed-crm.ts` seeds realistic `papa-s-saloon` data.
- [ ] Verification: `npm run typecheck` + full vitest, both green; golden-flow smoke.

## 11. Open items to resolve during planning (do not fabricate)

1. Confirm `scripts/migrate.ts` applies `055` with 051–054 absent (tracks applied files individually,
   not "max number"). If it requires contiguity, coordinate with the Main chat.
2. Confirm the exact `client_roles.bucket_family` join and that `papa-s-saloon` has ≥1 `customers` role
   (Booking's `ensureCustomerRole` lazily creates one on first guest booking).
3. Confirm `crm` product enable path for the demo tenant (seed insert vs. a one-liner the Main chat runs
   on prod) — v1 seeds dev; prod enable is an integration step.
