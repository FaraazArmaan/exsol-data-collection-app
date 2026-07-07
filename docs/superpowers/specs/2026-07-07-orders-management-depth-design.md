# ERP5 Order Management (`orders` module) — depth design

Status: approved 2026-07-07 · Branch: `feat/orders-depth-iso` (worktree ExSol-POS-WT) · Migrations **087–091** (092 spare) · Terminal POS · Ports 5181/8891

## Purpose

A new `orders` module: a management **surface** over the existing POS `sales`/`sale_lines`
pipeline. It NEVER forks sales — it reads `sales`/`sale_lines` and adds new `orders_*` tables
for what sales lacks (refund workflow, shipments, backorders, stage timing/SLA, split/merge
fulfillments). Six depth features, one commit each.

## Cross-cutting conventions

- **Permissions:** bucket×verb, `orders.business.{view,create,edit,delete}` (bucket `business`,
  mirrors finance). `ALL_ORDERS_PERMS` shared by `_orders-authz.ts` + RouteMount.
- **Authz order (Iron Rule 2):** `_orders-authz.ts` — `requireBucketUser` (401) → resolve level
  → **enable-gate 412 `orders_module_not_enabled`** → **`level_number === 1` L1 bypass** (full
  perm set) → per-key 403. Mirrored in RouteMount + Sidebar/nav.
- **Scoping:** `sales.bucket_id` IS the client id (FK clients). Every `orders_*` table carries
  `client_id`; every query filters by it; cross-tenant id → 404.
- **Money:** BIGINT cents (Neon returns strings → `Number()`). Wire `clients.base_currency`
  (migration 137, default INR) → `formatMoney(cents, code)` from `src/lib/currency.ts`. Orders
  is the first module to wire base_currency end-to-end; read it per query.
- **Seams consumed (never reinvented):** `_shared/pdf.ts` `renderPdf(doc): Promise<Uint8Array>`;
  `_shared/audit.ts` `logAudit(sql, {session, op, clientId, targetType, targetId, detail})`;
  `_pos-fsm.ts` transition rules (`ALLOWED_FROM`); `stock_movements`/`inventory_stock` ledger;
  `@registry/*` alias in functions.
- **Nav:** `hasDedicatedNav: true` + `navLinks` in the ModuleManifest (no hand-synced sets).
- **CSS:** `.ord-*` namespace, theme tokens from `src/lib/theme.css` ONLY; verify dark + 560px
  mobile in a real browser (jsdom catches neither).
- **Functions:** flat files, name-based routing; two functions sharing `config.path` both set
  `config.method`; use hyphenated `-detail/:id` / `-advance/:id` segments.
- **Migrations:** 087–091 sequential; one SQL statement per line; comments on their own line,
  never after a `;`. The untracked leftover `046_*` in this worktree is left unstaged; run
  `npm run migrate:status` before applying so it can't apply unexpectedly.

## Sales facts the design relies on (verified)

- `sales(id, bucket_id, order_no, status sale_status, channel sale_channel, customer_name/phone/
  email, subtotal/discount/tax/total_cents, created_by_user_node, created_at, paid_at,
  fulfilled_at, cancelled_at, refunded_at, payment_method, payment_ref, source)`.
- `sale_status` = pending_payment | paid | fulfilled | cancelled | refunded.
  `sale_channel` = instore | online | pickup. `source` = pos | storefront.
- `sale_lines(id, sale_id→sales cascade, product_id→products restrict, product_name_snap,
  unit_price_cents, qty, line_total_cents, position)`.
- FSM (`_pos-fsm.ts`): markPaid(pending_payment→paid), fulfill(paid→fulfilled),
  cancel(pending_payment→cancelled), refund(paid|fulfilled→refunded); instore+markPaid
  auto→fulfilled. Only `pos-sale-state.ts` mutates status; fulfill writes
  `stock_movements(client_id, product_id, -qty, 'sale', 'sale:<id>', user)`, fail-open,
  `GREATEST(0, qty_on_hand-qty)` floor, skipped when no `inventory_stock` row.

## Feature 1 — Order Dashboard (commit 1, includes module scaffold)

**Scaffold (part of commit 1):** ModuleManifest `orders` (`data_buckets:['business']`, verbs all
four, `vendor_side:true`, `hasDedicatedNav:true`, navLinks to `/orders`), ProductManifest `orders`
(`modules:[{module:'orders',side:'vendor'}]`, `requires:['pos']`), registered in `modules.ts` +
`products.ts`. `_orders-authz.ts`. `OrdersRouteMounts.tsx`. `src/modules/orders/shared/{types,
api,permissions}.ts`. `orders.css`. Sidebar entry. Route `/c/:slug/orders`.

**Feature:** `GET /api/orders/dashboard` → KPIs computed over `sales` for the client:
counts + total_cents grouped by `status` and by `channel`; open-order count/value
(status in pending_payment,paid); today/period revenue (paid); avg fulfilment time
(fulfilled_at − paid_at); counts of active backorders + SLA breaches (once those features land —
degrade to 0 when their tables are empty). FE: dashboard landing with KPI cards + status/channel
breakdown table, money via `formatMoney(_, base_currency)`. Empty/loading/error states.

## Feature 2 — Return/Refund + Shipment Tracking (commit 2, migration 087)

**087:** `refund_state` enum (requested, approved, rejected, completed);
`orders_refunds(id, client_id, sale_id→sales, amount_cents bigint CHECK>0, reason text,
state refund_state default requested, requested_by→user_nodes null, created_at, updated_at,
completed_at)`. `shipment_status` enum (pending, shipped, in_transit, delivered, returned);
`orders_shipments(id, client_id, sale_id→sales, carrier text, tracking_ref text,
status shipment_status default pending, shipped_at, delivered_at, created_at, updated_at)`.
`set_updated_at` triggers. Indexes on (client_id, sale_id).

**Endpoints:** `GET,POST /api/orders/refunds` (create scoped to an owned sale; amount ≤ sale total;
partial allowed). `POST /api/orders/refund-advance/:id` `{to}` — refund_state FSM
(requested→approved|rejected, approved→completed). **On completed AND amount == sale.total_cents:**
guarded `UPDATE sales SET status='refunded', refunded_at=now() WHERE id=… AND client_id=… AND
status IN ('paid','fulfilled')` (reuses `_pos-fsm` ALLOWED_FROM['refund']); if the guard matches 0
rows → `409 sale_not_refundable` and the refund still completes (workflow vs sale-status decoupled
on the failure path). Partial refund never touches sale.status. `logAudit` op `orders.refund.*`.
`GET,POST /api/orders/shipments` + `PUT /api/orders/shipment-detail/:id` (carrier/tracking/status;
setting delivered stamps delivered_at). All cross-tenant → 404.

**FE:** Refunds & Shipments tab: per-sale refund request + state advance; shipment carrier/tracking
entry + status; shortfall/validation states.

## Feature 3 — Backordering (commit 3, migration 088)

**088:** `backorder_status` enum (queued, partially_fulfilled, fulfilled, cancelled);
`orders_backorders(id, client_id, sale_id→sales, product_id→products, product_name_snap,
qty_ordered int CHECK>0, qty_fulfilled int default 0 CHECK>=0, status backorder_status default
queued, created_at, updated_at, fulfilled_at, CHECK qty_fulfilled<=qty_ordered)`. Index
(client_id, status).

**Endpoints:** `GET,POST /api/orders/backorders` — accept an out-of-stock line onto the queue
(create: validate sale+product owned; qty>0). `POST /api/orders/backorder-fulfill/:id`
`{qty}` — fulfil qty from arrived stock: **guarded** — verify `inventory_stock.qty_on_hand >= qty`
(pre-check → `409 insufficient_stock {have,need}`); then one `sql.transaction`: decrement stock
(no clamp; `qty_on_hand>=0` CHECK backstop, catch 23514→409) + `stock_movements(-qty,'sale',
'backorder:<id>', user)`; bump qty_fulfilled; status → partially_fulfilled or fulfilled (+
fulfilled_at). `logAudit` op `orders.backorder.fulfil`.

**FE:** Backorders tab: queue list with qty_ordered/qty_fulfilled, per-row fulfil (qty input);
insufficient-stock inline message; empty/loading/error.

## Feature 4 — Pick-Pack PDF (commit 4, no migration)

**Endpoints:** `GET /api/orders/pick-list/:id` and `GET /api/orders/packing-slip/:id` — `:id` is a
sale id (pick list) or a fulfillment id (once F6 lands; sale-level in this feature). Read sale +
lines (or fulfillment + its lines), build a `PdfDoc` (heading, meta = order_no/customer/date, rows
= product × qty × location placeholder for pick list; packing slip adds address/carrier when a
shipment exists), `renderPdf(doc)` → `new Response(bytes, {headers:{'Content-Type':
'application/pdf','Content-Disposition':'attachment; filename=…'}})`. Perm `orders.business.view`.
Cross-tenant/unknown id → 404.

**FE:** "Print pick list" / "Print packing slip" buttons on an order detail/row → open the PDF URL
(new tab / download). Tests assert 200 + `application/pdf` content-type + non-empty body, and 404
scoping.

## Feature 5 — SLA Task Time Tracking (commit 5, migration 089)

**089:** `order_stage` enum (pending_payment, paid, fulfilled, cancelled, refunded, picking,
packing, shipped, delivered, backordered); `orders_stage_events(id, client_id, sale_id→sales,
stage order_stage, entered_at timestamptz default now(), source text)`; index (client_id, sale_id,
entered_at). `orders_sla_targets(id, client_id, stage order_stage, max_minutes int CHECK>0,
UNIQUE(client_id, stage))`. **Trigger** `orders_sales_stage_event` AFTER UPDATE ON `sales` (observer
only; does NOT alter FSM logic): when `NEW.status <> OLD.status`, INSERT a stage_events row
(sale_id, stage=NEW.status::text::order_stage, source='sales_trigger'). **Backfill**: seed initial
stage events from existing sales' timestamps (created_at→that status chain) so history isn't empty.
Orders handlers (picking/packing/shipped/delivered) also insert stage_events with source='orders'.

**Endpoints:** `GET /api/orders/sla` — per-sale (or aggregate) time-in-stage from consecutive
`orders_stage_events.entered_at` diffs (current stage uses now()); breach flag when a stage
duration > its `orders_sla_targets.max_minutes`; returns rows + breach counts.
`PUT /api/orders/sla-targets` — upsert targets per stage (`orders.business.edit`).

**FE:** SLA tab: targets editor + a breach list (order, stage, elapsed vs target); empty/loading.

## Feature 6 — Split-merge Engine (commit 6, migrations 090–091)

**090 (split):** `fulfillment_status` enum (pending, picked, packed, shipped, fulfilled,
cancelled); `orders_fulfillments(id, client_id, sale_id→sales, label text, status
fulfillment_status default pending, created_at, updated_at, fulfilled_at)`;
`orders_fulfillment_lines(id, fulfillment_id→orders_fulfillments cascade, sale_line_id→sale_lines
restrict, qty int CHECK>0, UNIQUE(fulfillment_id, sale_line_id))`. `set_updated_at` trigger.

**091 (merge):** `orders_merge_groups(id, client_id, primary_sale_id→sales, customer_key text,
created_at)`; `orders_merge_members(id, group_id→orders_merge_groups cascade, sale_id→sales,
UNIQUE(group_id, sale_id))`.

**Endpoints:**
- `POST /api/orders/split/:saleId` `{fulfillments:[{label, lines:[{sale_line_id, qty}]}]}` —
  partitions a sale's lines; **handler enforces** per sale_line: `SUM(assigned qty) ≤ sale_line.qty`
  (else `409 over_fulfillment {sale_line_id}`); creates fulfillments + lines in one transaction;
  `logAudit` op `orders.split`.
- `GET /api/orders/fulfillments?sale_id=` — list with their lines + status.
- `POST /api/orders/fulfillment-advance/:id` `{to}` — fulfillment_status FSM
  (pending→picked→packed→shipped→fulfilled; any→cancelled). **On →fulfilled**: one
  `sql.transaction` consuming each fulfillment line's stock (`stock_movements(-qty,'sale',
  'fulfillment:<id>', user)`, guarded `qty_on_hand>=0`, catch 23514→409 `insufficient_stock`) +
  `fulfilled_at=now()` + a `picking/packing/shipped/delivered` stage_event as appropriate;
  `logAudit`. Transitions also emit stage_events (source='orders').
- `POST /api/orders/merge` `{primary_sale_id, sale_ids:[…]}` — same-customer OPEN sales
  (status in pending_payment,paid; matched by customer_phone) grouped; validates all owned + same
  customer_key + open; creates group + members; `logAudit` op `orders.merge`. Merged pick list
  spans all member sales.

**FE:** Fulfillments tab: split a sale into fulfillments (line/qty allocation UI), advance each
fulfillment, merge same-customer open orders. Print pick/packing per fulfillment (F4 reused).
Empty/loading/error + over-allocation guardrails.

## Testing

- Integration tests per feature under `tests/orders/*` (call handlers directly with a bucket-user
  session; `tests/orders/_helpers.ts` seeds an orders-enabled client + sample sales). Randomize
  unique-constrained literals (shared persistent dev DB, no teardown). No Blobs → no getStore mock.
- Cover: authz (412/403/L1), each endpoint's happy path + ownership 404 + validation, the
  refund→sale-status coupling (full vs partial), backorder insufficient-stock 409 + no-write,
  split over-fulfillment 409, fulfillment-fulfil stock consumption + movements, SLA breach math,
  PDF content-type. `npm run typecheck` + FULL vitest suite green before handoff.
- Seed `scripts/seed-orders.ts` extended per feature so every feature demos with realistic
  papa-s-saloon data.

## Known deferrals / risks

- Concurrent double-fulfil of a fulfillment (same class as Manufacturing 058): the `qty>=0` CHECK
  is the backstop; a full row-lock is deferred (document in the handler).
- Merge is a linking layer; it does not renumber/merge `order_no` or move lines between sales.
- Refund workflow and sale.status are only coupled on the full-refund-completed happy path; on a
  409 (sale not in paid/fulfilled) the refund still records — surfaced to the operator.
