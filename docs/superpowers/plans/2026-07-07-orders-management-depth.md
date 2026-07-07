# ERP5 Order Management (`orders`) Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **One commit per feature/task** (mission cadence): `feat(orders): <feature>`.

**Goal:** Build the 6-feature `orders` depth module — a management surface over the POS `sales` pipeline (dashboard, refund/shipment, backordering, pick-pack PDF, SLA time-tracking, split-merge).

**Architecture:** New `orders` registry module (bucket×verb `orders.business.*`), flat `/api/orders/*` Netlify functions gated by `_orders-authz.ts`, `src/modules/orders/` frontend mirroring `inventory`/`finance`, new `orders_*` tables (migs 087–091) alongside — never forking — `sales`/`sale_lines`. Reuses seams: `renderPdf`, `logAudit`, `_pos-fsm` rules, `stock_movements`, `formatMoney`+`base_currency`.

**Tech Stack:** Neon Postgres, Netlify Functions v2 (Web Request/Response), React 18 + Vite + react-router, Vitest integration tests (shared dev DB), `@neondatabase/serverless` (`sql` + `sql.transaction`).

## Global Constraints

- **Worktree** `ExSol-POS-WT`, **branch** `feat/orders-depth-iso`. Verify `git branch --show-current` before first commit. NEVER push/merge. Stage by explicit path (never `git add -A`; an untracked leftover `046_backfill_l1_pos_permissions.sql` lives in the tree — never stage it).
- **Migrations 087–091 sequential**, 092 spare. One SQL statement per line; comments on their own line, never after a `;`. Run `npm run migrate:status` before `npm run migrate` (confirm only your new file is pending; if `046` shows pending, STOP and report).
- **Permissions bucket×verb only:** `orders.business.{view,create,edit,delete}`. Authz = `requireBucketUser` → enable-gate `412 orders_module_not_enabled` → `level_number === 1` L1 bypass (full `ALL_ORDERS_PERMS`) → per-key 403. Same order in RouteMount + Sidebar.
- **Scope every query by `client_id`** (= `sales.bucket_id`); cross-tenant id → 404.
- **Money:** BIGINT cents, `Number()` on read (Neon returns strings). Read `clients.base_currency`; FE formats via `formatMoney(cents, base_currency)` from `src/lib/currency.ts`.
- **Seams:** `renderPdf(doc: PdfDoc): Promise<Uint8Array>` from `netlify/functions/_shared/pdf.ts`; `logAudit(sql, {session, op, clientId, targetType, targetId, detail})` from `_shared/audit.ts`; `stock_movements(client_id, product_id, qty_delta, type, ref, created_by)`; `inventory_stock.qty_on_hand` with `qty_on_hand>=0` CHECK. `@registry/*` alias in functions.
- **Functions:** flat files; hyphenated `-detail/:id` / `-advance/:id`; `config.method` set on every function; two sharing a path both set method.
- **CSS** `.ord-*`, theme tokens only; 560px mobile; verify in a real browser.
- **Tests:** integration under `tests/orders/`; randomize unique literals; no Blobs → no getStore mock. `npm run typecheck` + orders tests green after each commit; FULL suite green before handoff.
- **Reference/mirror files:** authz `_finance-authz.ts`/`_inventory-authz.ts`; detail routing + `:id` extraction `finance-expense-detail.ts` (`new URL(req.url).pathname.split('/').pop()`, `UUID_RE`→404); transaction/consume pattern `manufacturing-order-advance.ts`; FE module `src/modules/inventory/` (RouteMounts, shared/api.ts throw-on-error, permissions.ts).

## File Structure

Scaffold (Task 1) then per-feature additions:
- `netlify/functions/_orders-authz.ts`, `orders-dashboard.ts`, `orders-refunds.ts`, `orders-refund-advance.ts`, `orders-shipments.ts`, `orders-shipment-detail.ts`, `orders-backorders.ts`, `orders-backorder-fulfill.ts`, `orders-pick-list.ts`, `orders-packing-slip.ts`, `orders-sla.ts`, `orders-sla-targets.ts`, `orders-split.ts`, `orders-fulfillments.ts`, `orders-fulfillment-advance.ts`, `orders-merge.ts`
- `db/migrations/087_orders_refunds_shipments.sql`, `088_orders_backorders.sql`, `089_orders_sla.sql`, `090_orders_fulfillments.sql`, `091_orders_merge.sql`
- `src/modules/registry/manifests/orders.ts`, `src/modules/registry/products-list/orders.ts` (+ register in `modules.ts`, `products.ts`)
- `src/modules/orders/OrdersRouteMounts.tsx`, `orders.css`, `shared/{types,api,permissions}.ts`, `workspace/pages/OrdersPage.tsx`, `workspace/components/*` per feature
- `src/lib/router.tsx`, `src/modules/user-portal/layout/Sidebar.tsx` (additive)
- `scripts/seed-orders.ts` (+ `package.json` `seed:orders`)
- `tests/orders/{_helpers,authz,dashboard,refunds,shipments,backorders,pickpack,sla,split-merge}.test.ts`

---

### Task 1: Order Dashboard + module scaffold

**Files:** Create `src/modules/registry/manifests/orders.ts`, `src/modules/registry/products-list/orders.ts`, `netlify/functions/_orders-authz.ts`, `netlify/functions/orders-dashboard.ts`, `src/modules/orders/OrdersRouteMounts.tsx`, `src/modules/orders/orders.css`, `src/modules/orders/shared/{types,api,permissions}.ts`, `src/modules/orders/workspace/pages/OrdersDashboardPage.tsx`, `tests/orders/_helpers.ts`, `tests/orders/authz.test.ts`, `tests/orders/dashboard.test.ts`, `tests/unit/orders-registry.test.ts`. Modify `src/modules/registry/modules.ts`, `src/modules/registry/products.ts`, `src/lib/router.tsx`, `src/modules/user-portal/layout/Sidebar.tsx`.

**Interfaces produced:** `requireOrders(req, required): Promise<{ok:true;ctx:{userNodeId,clientId,perms}}|{ok:false;res}>`, `ALL_ORDERS_PERMS = ['orders.business.view','orders.business.create','orders.business.edit','orders.business.delete']`; `session` for `logAudit` = `{kind:'bucket_user', user_node_id: ctx.userNodeId}` — export a helper `ordersAuditSession(ctx)` returning that shape from `_orders-authz.ts`.

- [ ] **Step 1: Registry manifests + registration** (mirror `manifests/finance.ts` / `products-list/finance.ts`).
`manifests/orders.ts`:
```ts
import type { ModuleManifest } from '../types';
export const ordersManifest: ModuleManifest = {
  key: 'orders',
  label: 'Order Management',
  data_buckets: ['business'],
  verbs: ['view', 'create', 'edit', 'delete'],
  vendor_side: true,
  customer_side: false,
  hasDedicatedNav: true,
  navLinks: [{ path: '/orders', label: 'Orders', viewKeys: ['orders.business.view'], order: 55 }],
};
```
`products-list/orders.ts`:
```ts
import type { ProductManifest } from '../types';
export const ordersProduct: ProductManifest = {
  key: 'orders',
  label: 'Order Management',
  modules: [{ module: 'orders', side: 'vendor' }],
  requires: ['pos'],
};
```
Register both additively in `modules.ts` (`orders: ordersManifest`) and `products.ts` (`'orders': ordersProduct`), after the last existing entry.

- [ ] **Step 2: Registry unit test** `tests/unit/orders-registry.test.ts` (mirror the manufacturing registry test): assert `getModule('orders').data_buckets === ['business']`, `getModule('orders').hasDedicatedNav === true`, `getProduct('orders').requires === ['pos']`, and `derivePermissionRows(['orders']).some(r => r.module.key==='orders' && r.bucket==='business')`. Run `npx vitest run tests/unit/orders-registry.test.ts` → PASS.

- [ ] **Step 3: Authz helper** `_orders-authz.ts` — copy `_inventory-authz.ts` verbatim, replace `inventory`→`orders`, `ALL_INVENTORY_PERMS`→`ALL_ORDERS_PERMS = ['orders.business.view','orders.business.create','orders.business.edit','orders.business.delete']`, gate module `'orders'`, error code `orders_module_not_enabled`. Add:
```ts
import type { AnySession } from './_shared/permissions';
export function ordersAuditSession(ctx: { userNodeId: string }): AnySession {
  return { kind: 'bucket_user', user_node_id: ctx.userNodeId } as AnySession;
}
```
(If `AnySession`'s `bucket_user` arm needs more fields, match its exact shape from `_shared/permissions.ts`.)

- [ ] **Step 4: Test helpers** `tests/orders/_helpers.ts` — mirror `tests/inventory/_helpers.ts`: `seedOrdersClient()` = `seedClientWithProductsEnabled()` (from `tests/pos/_helpers`) + enable `'orders'` product. Add `seedSale(ctx, {status?, channel?, total?, lines?})` inserting a `sales` row (bucket_id=clientId, order_no random, customer_name/phone randomized, status, channel, subtotal/total cents) + optional `sale_lines`, returning `{saleId, lineIds}`. Re-export `makeBucketUserRequest`, `seedProducts`, `seedStock`.

- [ ] **Step 5: Authz test** `tests/orders/authz.test.ts` — mirror manufacturing authz test using `orders-dashboard` handler: `412` when orders not enabled (seed a products-only client); `200` L1 owner; `403` L2 without `orders.business.view` (via `seedSubordinateUser`).

- [ ] **Step 6: Dashboard handler** `orders-dashboard.ts` — `config = { path: '/api/orders/dashboard', method: 'GET' }`, perm `orders.business.view`. Query `sales` for `bucket_id = clientId`:
```ts
// counts + totals by status and by channel; open (pending_payment,paid); avg fulfil secs.
const byStatus = await sql`SELECT status, COUNT(*)::int n, COALESCE(SUM(total_cents),0)::bigint cents FROM public.sales WHERE bucket_id=${clientId}::uuid GROUP BY status`;
const byChannel = await sql`SELECT channel, COUNT(*)::int n, COALESCE(SUM(total_cents),0)::bigint cents FROM public.sales WHERE bucket_id=${clientId}::uuid GROUP BY channel`;
const open = await sql`SELECT COUNT(*)::int n, COALESCE(SUM(total_cents),0)::bigint cents FROM public.sales WHERE bucket_id=${clientId}::uuid AND status IN ('pending_payment','paid')`;
const avg = await sql`SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (fulfilled_at - paid_at))),0)::int secs FROM public.sales WHERE bucket_id=${clientId}::uuid AND fulfilled_at IS NOT NULL AND paid_at IS NOT NULL`;
const cur = await sql`SELECT base_currency FROM public.clients WHERE id=${clientId}::uuid LIMIT 1`;
```
Return `{ base_currency, by_status:[{status,n,cents:Number}], by_channel:[…], open:{n,cents:Number}, avg_fulfil_secs, backorders_active:0, sla_breaches:0 }` (last two are 0 here; extended in Tasks 3/5 — add the columns then). `Number()` every `cents`/bigint.

- [ ] **Step 7: Dashboard test** `tests/orders/dashboard.test.ts` — seed 3 sales (paid instore, pending online, fulfilled pickup with paid_at+fulfilled_at); GET dashboard; assert `by_status` has the right counts, `open.n===2` (paid+pending), `avg_fulfil_secs>0`, `base_currency` present, cross-client sales excluded (seed a second client's sale, assert not counted).

- [ ] **Step 8: FE shared + RouteMount + page + nav** — `shared/types.ts` (Dashboard wire types + shared enums), `shared/api.ts` (throw-on-error `ordersApi` mirror of inventory's, `dashboard()` call), `shared/permissions.ts` (`ALL_ORDERS_PERMS` + `canViewOrders`/`canEditOrders`/`canCreateOrders`). `OrdersRouteMounts.tsx` mirror `InventoryRouteMounts` gating on `orders.business.view`, module key `orders`, rendering `OrdersDashboardPage`. `OrdersDashboardPage.tsx` — KPI cards (open orders, open value via `formatMoney`, avg fulfil time) + by-status/by-channel tables; loading/empty/error states; `.ord-*` classes; 560px stacking. `orders.css` on theme tokens. `router.tsx`: import + `{ path: 'orders', element: <OrdersDashboardMount /> }`. `Sidebar.tsx`: `showOrders` (enabled + owner/`orders.business.view`) + NavLink `/c/${slug}/orders` + include in Modules-group OR.

- [ ] **Step 9: Seed** create `scripts/seed-orders.ts` (idempotent, papa-s-saloon; enable products+pos+orders; insert a spread of sales across statuses/channels via the SKU-safe pattern from `seed-inventory.ts`) + `package.json` `"seed:orders": "tsx --env-file=.env scripts/seed-orders.ts"`. Run it twice (idempotent).

- [ ] **Step 10: Verify + commit** `npm run typecheck`; `npx vitest run tests/orders/ tests/unit/orders-registry.test.ts` → green. Commit: `git add` (by path) the created/modified files → `git commit -m "feat(orders): Order Dashboard + module scaffold (registry, authz, route, seed)"`.

---

### Task 2: Return/Refund + Shipment Tracking (migration 087)

**Files:** Create `db/migrations/087_orders_refunds_shipments.sql`, `netlify/functions/orders-refunds.ts`, `orders-refund-advance.ts`, `orders-shipments.ts`, `orders-shipment-detail.ts`, `tests/orders/refunds.test.ts`, `tests/orders/shipments.test.ts`, FE `workspace/components/RefundsShipmentsTab.tsx`. Modify `shared/{types,api}.ts`, `OrdersDashboardPage.tsx` (add tab), `scripts/seed-orders.ts`.

**Interfaces consumed:** `requireOrders`, `ordersAuditSession`, `logAudit`, `_pos-fsm` `ALLOWED_FROM` (import `{ ALLOWED_FROM }` from `./_pos-fsm`).

- [ ] **Step 1: Migration 087** (one stmt/line, comments own line):
```sql
-- Migration 087: orders refund workflow + shipment tracking (orders module).
-- Additive over sales; never forks the sale FSM.
create type refund_state as enum ('requested', 'approved', 'rejected', 'completed');
create type shipment_status as enum ('pending', 'shipped', 'in_transit', 'delivered', 'returned');
create table if not exists public.orders_refunds (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  sale_id      uuid not null references public.sales(id)   on delete cascade,
  amount_cents bigint not null,
  reason       text,
  state        refund_state not null default 'requested',
  requested_by uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  constraint orders_refunds_amount_pos check (amount_cents > 0)
);
create index if not exists orders_refunds_client_sale_idx on public.orders_refunds (client_id, sale_id);
create table if not exists public.orders_shipments (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  sale_id      uuid not null references public.sales(id)   on delete cascade,
  carrier      text,
  tracking_ref text,
  status       shipment_status not null default 'pending',
  shipped_at   timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists orders_shipments_client_sale_idx on public.orders_shipments (client_id, sale_id);
create trigger orders_refunds_updated_at before update on public.orders_refunds for each row execute function public.set_updated_at();
create trigger orders_shipments_updated_at before update on public.orders_shipments for each row execute function public.set_updated_at();
```
Run `npm run migrate:status` (confirm only 087 pending), then `npm run migrate`.

- [ ] **Step 2: refunds handler** `orders-refunds.ts` — `{path:'/api/orders/refunds', method:['GET','POST']}`. GET (perm view): list refunds for client (join sales for order_no/customer). POST (perm create): body `{sale_id, amount_cents, reason?}`; validate sale owned (`SELECT … WHERE id AND bucket_id=clientId`→404 `sale_not_found`); `amount_cents` int>0 and ≤ sale.total_cents (else 400 `amount_invalid`); insert `state='requested', requested_by=userNodeId`; `logAudit(sql,{session:ordersAuditSession(ctx),op:'orders.refund.requested',clientId,targetType:'sale',targetId:sale_id,detail:{amount_cents}})`; return 201 `{id, state}`.

- [ ] **Step 3: refund-advance handler** `orders-refund-advance.ts` — `{path:'/api/orders/refund-advance/:id', method:'POST'}`, perm edit, `UUID_RE`→404, `:id` via `pathname.split('/').pop()`. Body `{to}` ∈ {approved,rejected,completed}. Load refund+sale scoped by client (404). Legal: `requested→approved|rejected`, `approved→completed`; else `409 illegal_transition`. On `completed`: set `state='completed', completed_at=now()`. **If `amount_cents === sale.total_cents`**: guarded coupling —
```ts
const canRefund = ALLOWED_FROM['refund']; // ['paid','fulfilled']
const upd = await sql`UPDATE public.sales SET status='refunded', refunded_at=now() WHERE id=${saleId}::uuid AND bucket_id=${clientId}::uuid AND status = ANY(${canRefund}::sale_status[]) RETURNING id`;
// upd.length===0 → sale not in paid/fulfilled: refund still completes; include {sale_refunded:false} in response
```
`logAudit` op `orders.refund.<to>`. Return `{id, state, sale_refunded: boolean}`.

- [ ] **Step 4: shipments handlers** `orders-shipments.ts` `{path:'/api/orders/shipments', method:['GET','POST']}` (GET list; POST create `{sale_id, carrier?, tracking_ref?}` → validate sale owned, insert `status='pending'`, 201). `orders-shipment-detail.ts` `{path:'/api/orders/shipment-detail/:id', method:['GET','PUT']}` — PUT `{carrier?, tracking_ref?, status?}`; on `status='shipped'` set `shipped_at=now()` if null; on `status='delivered'` set `delivered_at=now()`; scoped 404.

- [ ] **Step 5: tests** `tests/orders/refunds.test.ts`: create refund (partial) → 201; advance requested→approved→completed; **full-amount refund on a paid sale → sale.status becomes 'refunded'** (assert via a `sales` read); **full-amount refund on a pending_payment sale → 200 with `sale_refunded:false` and sale.status unchanged**; partial refund completed → sale.status unchanged; amount > total → 400; foreign sale → 404; illegal transition → 409. `tests/orders/shipments.test.ts`: create shipment; PUT to shipped stamps shipped_at; PUT to delivered stamps delivered_at; foreign id → 404.

- [ ] **Step 6: FE** `RefundsShipmentsTab.tsx` — refund request form (sale picker + amount + reason), refund list with state-advance buttons + `sale_refunded` feedback; shipment form + list with status advance. Wire `ordersApi.refunds/refundAdvance/shipments/shipmentDetail`. States handled; 560px.

- [ ] **Step 7: Seed + verify + commit** extend `seed-orders.ts` (a couple refunds in mixed states, a shipment). `npm run typecheck`; `npx vitest run tests/orders/` green. Commit `feat(orders): Return/Refund + Shipment Tracking (migration 087)`.

---

### Task 3: Backordering (migration 088)

**Files:** Create `db/migrations/088_orders_backorders.sql`, `netlify/functions/orders-backorders.ts`, `orders-backorder-fulfill.ts`, `tests/orders/backorders.test.ts`, FE `workspace/components/BackordersTab.tsx`. Modify `shared/{types,api}.ts`, `orders-dashboard.ts` (add `backorders_active` count), FE dashboard tab list, `seed-orders.ts`.

- [ ] **Step 1: Migration 088**:
```sql
-- Migration 088: orders backorder queue.
create type backorder_status as enum ('queued', 'partially_fulfilled', 'fulfilled', 'cancelled');
create table if not exists public.orders_backorders (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id)  on delete cascade,
  sale_id           uuid not null references public.sales(id)    on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  product_name_snap text not null,
  qty_ordered       int not null,
  qty_fulfilled     int not null default 0,
  status            backorder_status not null default 'queued',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  fulfilled_at      timestamptz,
  constraint orders_backorders_qty_ordered_pos check (qty_ordered > 0),
  constraint orders_backorders_qty_fulfilled_nonneg check (qty_fulfilled >= 0),
  constraint orders_backorders_qty_bound check (qty_fulfilled <= qty_ordered)
);
create index if not exists orders_backorders_client_status_idx on public.orders_backorders (client_id, status);
create trigger orders_backorders_updated_at before update on public.orders_backorders for each row execute function public.set_updated_at();
```

- [ ] **Step 2: backorders handler** `orders-backorders.ts` `{path:'/api/orders/backorders', method:['GET','POST']}`. GET list (client-scoped). POST create `{sale_id, product_id, qty_ordered}`: validate sale + product owned; snapshot product name; insert `status='queued'`. 201.

- [ ] **Step 3: backorder-fulfill handler** `orders-backorder-fulfill.ts` `{path:'/api/orders/backorder-fulfill/:id', method:'POST'}`, perm edit. Body `{qty}` int>0. Load backorder scoped (404). `remaining = qty_ordered - qty_fulfilled`; `qty>remaining` → 400 `qty_exceeds_remaining`. Pre-check stock: `SELECT qty_on_hand FROM inventory_stock WHERE client_id AND product_id`; missing row or `qty_on_hand < qty` → `409 insufficient_stock {have, need:qty}`. Then one `sql.transaction` (mirror `manufacturing-order-advance` decrement, NO clamp; catch `23514`→409):
```ts
sql`UPDATE public.inventory_stock SET qty_on_hand = qty_on_hand - ${qty}::int, updated_at=now() WHERE client_id=${clientId}::uuid AND product_id=${productId}::uuid`,
sql`INSERT INTO public.stock_movements (client_id, product_id, qty_delta, type, ref, created_by) VALUES (${clientId}::uuid, ${productId}::uuid, ${-qty}::int, 'sale', ${'backorder:'+id}, ${userNodeId}::uuid)`,
sql`UPDATE public.orders_backorders SET qty_fulfilled = qty_fulfilled + ${qty}::int, status = CASE WHEN qty_fulfilled + ${qty}::int >= qty_ordered THEN 'fulfilled'::backorder_status ELSE 'partially_fulfilled'::backorder_status END, fulfilled_at = CASE WHEN qty_fulfilled + ${qty}::int >= qty_ordered THEN now() ELSE fulfilled_at END, updated_at=now() WHERE id=${id}::uuid AND client_id=${clientId}::uuid`,
```
`logAudit` op `orders.backorder.fulfil` detail `{qty}`. Return `{id, status, qty_fulfilled}`.

- [ ] **Step 4: tests** `tests/orders/backorders.test.ts`: create backorder; fulfil partial (stock 100, qty 3) → status partially_fulfilled, stock 97, a `stock_movements` row `ref='backorder:<id>' qty_delta=-3`; fulfil the rest → fulfilled + fulfilled_at set; **insufficient stock (stock 2, qty 5) → 409, no stock change, no movement, backorder unchanged**; qty>remaining → 400; foreign id → 404.

- [ ] **Step 5: dashboard extension** in `orders-dashboard.ts` add `SELECT COUNT(*)::int FROM public.orders_backorders WHERE client_id=… AND status IN ('queued','partially_fulfilled')` → `backorders_active`.

- [ ] **Step 6: FE + seed + verify + commit** `BackordersTab.tsx` (queue list, per-row fulfil qty input, insufficient-stock inline error, states); seed a couple backorders; typecheck + `tests/orders/` green. Commit `feat(orders): Backordering (migration 088)`.

---

### Task 4: Pick-Pack PDF (no migration)

**Files:** Create `netlify/functions/orders-pick-list.ts`, `orders-packing-slip.ts`, `tests/orders/pickpack.test.ts`, FE buttons in an order row/detail. Modify `shared/api.ts`.

**Interfaces consumed:** `renderPdf`, `PdfDoc` from `_shared/pdf.ts`; `formatMoney`.

- [ ] **Step 1: pick-list handler** `orders-pick-list.ts` `{path:'/api/orders/pick-list/:id', method:'GET'}`, perm view, `UUID_RE`→404. `:id` = sale id. Load sale (scoped 404) + its lines ordered by position + `base_currency`. Build `PdfDoc`:
```ts
const doc = { title:`Pick List #${sale.order_no}`, heading:`Pick List — Order #${sale.order_no}`,
  meta:[{label:'Customer',value:sale.customer_name},{label:'Channel',value:sale.channel},{label:'Date',value:new Date(sale.created_at).toISOString().slice(0,10)}],
  rows: lines.map(l=>({label:`${l.product_name_snap} ×${l.qty}`, value:'[ ] picked'})),
  footer:'Generated by ExSol Orders' };
const bytes = await renderPdf(doc);
return new Response(bytes, {status:200, headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="pick-list-${sale.order_no}.pdf"`}});
```

- [ ] **Step 2: packing-slip handler** `orders-packing-slip.ts` `{path:'/api/orders/packing-slip/:id', method:'GET'}` — same load; rows show product × qty × `formatMoney(line_total_cents, base_currency)`; meta adds carrier/tracking if an `orders_shipments` row exists for the sale; footer total.

- [ ] **Step 3: tests** `tests/orders/pickpack.test.ts`: seed sale + lines; GET pick-list → 200, `content-type` `application/pdf`, body byte length > 0; GET packing-slip → 200 pdf; foreign/unknown id → 404. (Assert on `res.headers.get('content-type')` and `(await res.arrayBuffer()).byteLength > 100`.)

- [ ] **Step 4: FE + verify + commit** add "Print pick list" / "Print packing slip" links (open `/api/orders/pick-list/${id}` in new tab) on order rows. typecheck + `tests/orders/` green. Commit `feat(orders): Pick-Pack PDF (pick list + packing slip)`.

---

### Task 5: SLA Task Time Tracking (migration 089)

**Files:** Create `db/migrations/089_orders_sla.sql`, `netlify/functions/orders-sla.ts`, `orders-sla-targets.ts`, `tests/orders/sla.test.ts`, FE `workspace/components/SlaTab.tsx`. Modify `orders-dashboard.ts` (`sla_breaches` count), `shared/{types,api}.ts`, `seed-orders.ts`.

- [ ] **Step 1: Migration 089** (stage-events + targets — NO trigger, NO `$$`). **Design note (controller correction):** the migrate splitter (`scripts/migrate.ts:36`) treats ANY file containing `$$` as a single un-split statement, so a plpgsql trigger cannot share a file with the enum/tables — and splitting across extra files would exhaust the 087–092 budget. We therefore use NO DB trigger. Sale-status stage boundaries are derived at read time from the authoritative `sales` timestamps (`created_at`/`paid_at`/`fulfilled_at`/`cancelled_at`/`refunded_at`); `orders_stage_events` is the real event log for orders-specific stages (picking/packing/shipped/delivered), written by orders handlers. This delivers the granular custom-stage log without forking POS.
```sql
-- Migration 089: orders stage-event log (orders-specific stages) + SLA targets.
-- No DB trigger: sale-status stage boundaries derive from sales timestamps at read
-- time; this log captures orders-specific stages (picking/packing/shipped/delivered).
create type order_stage as enum ('pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded', 'picking', 'packing', 'shipped', 'delivered', 'backordered');
create table if not exists public.orders_stage_events (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  sale_id    uuid not null references public.sales(id)   on delete cascade,
  stage      order_stage not null,
  entered_at timestamptz not null default now(),
  source     text not null default 'orders'
);
create index if not exists orders_stage_events_sale_idx on public.orders_stage_events (client_id, sale_id, entered_at);
create table if not exists public.orders_sla_targets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  stage       order_stage not null,
  max_minutes int not null,
  constraint orders_sla_targets_minutes_pos check (max_minutes > 0),
  constraint orders_sla_targets_client_stage_uniq unique (client_id, stage)
);
```
No `$$`, so the splitter splits normally on end-of-line `;`. Run `npm run migrate:status` then `npm run migrate`.

- [ ] **Step 2: sla handler** `orders-sla.ts` `{path:'/api/orders/sla', method:'GET'}`, perm view. Build a per-sale stage timeline by UNION-ing two sources, then compute durations:
  - **Derived sale-status events** — a `UNION ALL` over the sale's non-null timestamps mapped to stages: `(created_at,'pending_payment')`, `(paid_at,'paid')`, `(fulfilled_at,'fulfilled')`, `(cancelled_at,'cancelled')`, `(refunded_at,'refunded')`, each `WHERE <ts> IS NOT NULL`, scoped `bucket_id=clientId`.
  - **Logged orders events** — `SELECT sale_id, stage, entered_at FROM orders_stage_events WHERE client_id=clientId`.
  Merge into one CTE `timeline(sale_id, stage, entered_at)`, then `LEAD(entered_at) OVER (PARTITION BY sale_id ORDER BY entered_at)` for `next_at`; `duration_minutes = EXTRACT(EPOCH FROM (COALESCE(next_at, now()) - entered_at))/60`. Join `orders_sla_targets` on stage; `breach = duration_minutes > max_minutes`. Return `{ targets:[{stage,max_minutes}], breaches:[{sale_id, order_no, stage, minutes:Number, max_minutes}], breach_count }` (join `sales` for `order_no`).

- [ ] **Step 3: sla-targets handler** `orders-sla-targets.ts` `{path:'/api/orders/sla-targets', method:['GET','PUT']}`. GET list. PUT (perm edit) `{targets:[{stage,max_minutes}]}` → upsert each `ON CONFLICT (client_id,stage) DO UPDATE`.

- [ ] **Step 4: tests** `tests/orders/sla.test.ts`:
  - **Derived-from-timestamps breach:** seed a sale with `paid_at = now()-INTERVAL '10 min'` and `fulfilled_at = now()`; set target `{stage:'paid', max_minutes:1}` via PUT; GET sla → a breach row for `paid` (~10min > 1). Set target max_minutes=1000 → no breach.
  - **Orders-specific stage event:** insert an `orders_stage_events` row directly (`stage='picking', entered_at=now()-INTERVAL '30 min'`) with no next event; set target `{stage:'picking', max_minutes:5}`; GET sla → breach for `picking` (~30 > 5) using `now()` as the open-stage end.
  - PUT targets upserts (second PUT of same stage updates max_minutes, no dup — relies on `unique(client_id,stage)`).
  - Cross-tenant sale excluded from breaches.

- [ ] **Step 5: dashboard extension** add `sla_breaches` count to `orders-dashboard.ts` (count breaches via the same window query, or a simpler "sales past target" count).

- [ ] **Step 6: FE + seed + verify + commit** `SlaTab.tsx` (targets editor + breach list); seed a couple SLA targets + a few `orders_stage_events` rows (and rely on sales timestamps for the derived stages). typecheck + `tests/orders/` green. Commit `feat(orders): SLA Task Time Tracking (migration 089)`.

---

### Task 6: Split-merge Engine (migrations 090–091)

**Files:** Create `db/migrations/090_orders_fulfillments.sql`, `091_orders_merge.sql`, `netlify/functions/orders-split.ts`, `orders-fulfillments.ts`, `orders-fulfillment-advance.ts`, `orders-merge.ts`, `tests/orders/split-merge.test.ts`, FE `workspace/components/FulfillmentsTab.tsx`. Modify `shared/{types,api}.ts`, `seed-orders.ts`.

- [ ] **Step 1: Migration 090**:
```sql
-- Migration 090: orders fulfillments (split a sale's lines into shippable groups).
create type fulfillment_status as enum ('pending', 'picked', 'packed', 'shipped', 'fulfilled', 'cancelled');
create table if not exists public.orders_fulfillments (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  sale_id      uuid not null references public.sales(id)   on delete cascade,
  label        text not null,
  status       fulfillment_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index if not exists orders_fulfillments_client_sale_idx on public.orders_fulfillments (client_id, sale_id);
create table if not exists public.orders_fulfillment_lines (
  id             uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.orders_fulfillments(id) on delete cascade,
  sale_line_id   uuid not null references public.sale_lines(id) on delete restrict,
  qty            int not null,
  constraint orders_fulfillment_lines_qty_pos check (qty > 0),
  constraint orders_fulfillment_lines_uniq unique (fulfillment_id, sale_line_id)
);
create trigger orders_fulfillments_updated_at before update on public.orders_fulfillments for each row execute function public.set_updated_at();
```

- [ ] **Step 2: Migration 091**:
```sql
-- Migration 091: orders merge groups (link same-customer open orders for combined pick-pack).
create table if not exists public.orders_merge_groups (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  primary_sale_id uuid not null references public.sales(id)   on delete cascade,
  customer_key    text not null,
  created_at      timestamptz not null default now()
);
create table if not exists public.orders_merge_members (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.orders_merge_groups(id) on delete cascade,
  sale_id  uuid not null references public.sales(id) on delete cascade,
  constraint orders_merge_members_uniq unique (group_id, sale_id)
);
create index if not exists orders_merge_groups_client_idx on public.orders_merge_groups (client_id);
```

- [ ] **Step 3: split handler** `orders-split.ts` `{path:'/api/orders/split/:saleId', method:'POST'}`, perm edit, UUID→404. Body `{fulfillments:[{label, lines:[{sale_line_id, qty}]}]}`. Load sale + its lines scoped (404). Validate: every `sale_line_id` belongs to the sale; per sale_line, `SUM(assigned qty) ≤ line.qty` (else `409 over_fulfillment {sale_line_id}`); each qty>0; ≥1 fulfillment. One `sql.transaction`: insert each fulfillment (`crypto.randomUUID()` ids) + its lines. `logAudit` op `orders.split` detail `{fulfillment_count}`. Return `{fulfillment_ids}`.

- [ ] **Step 4: fulfillments list** `orders-fulfillments.ts` `{path:'/api/orders/fulfillments', method:'GET'}` — `?sale_id=` optional; return fulfillments (client-scoped) each with their lines (join sale_lines for name/qty) + status.

- [ ] **Step 5: fulfillment-advance** `orders-fulfillment-advance.ts` `{path:'/api/orders/fulfillment-advance/:id', method:'POST'}`, perm edit, UUID→404. Body `{to}` ∈ fulfillment_status. Load fulfillment scoped (404). Legal FSM: pending→picked→packed→shipped→fulfilled; any-non-terminal→cancelled; fulfilled/cancelled terminal; else 409. On `picked/packing/shipped` also insert an `orders_stage_events` row (stage picking/packing/shipped, source='orders'). **On `fulfilled`**: pre-check stock for each fulfillment line (`inventory_stock.qty_on_hand >= qty`; shortfall → `409 insufficient_stock {shortfalls}`); one `sql.transaction`: per line decrement stock (no clamp; 23514→409) + `stock_movements(-qty,'sale','fulfillment:<id>',user)`; set `status='fulfilled', fulfilled_at=now()`; insert `delivered`/`shipped` stage_event. `logAudit` op `orders.fulfillment.<to>`. (Document the concurrent double-fulfil deferral in a comment, mirror Manufacturing 058.)

- [ ] **Step 6: merge handler** `orders-merge.ts` `{path:'/api/orders/merge', method:'POST'}`, perm edit. Body `{primary_sale_id, sale_ids:[…]}`. Validate all sales owned + OPEN (`status IN ('pending_payment','paid')`, else `409 sale_not_open`) + same `customer_phone` as primary (else `409 customer_mismatch`). `customer_key = primary.customer_phone`. One transaction: insert group + a member row per sale (incl. primary). `logAudit` op `orders.merge` detail `{member_count}`. Return `{group_id}`.

- [ ] **Step 7: tests** `tests/orders/split-merge.test.ts`: seed sale with 2 lines (qty 5, 3); split into 2 fulfillments (line A: 2 + 3 across two fulfillments; line B: 3) → 201; **over-allocation (line A total 6 > 5) → 409 over_fulfillment**; advance a fulfillment pending→picked→packed→shipped→fulfilled with stock present → stock consumed + `stock_movements ref='fulfillment:<id>'` + status fulfilled; **fulfil with insufficient stock → 409, no movement**; illegal transition → 409. Merge: two paid same-phone sales → group + 2 members; a fulfilled sale in the set → 409 sale_not_open; different-phone sale → 409 customer_mismatch; foreign sale → 404.

- [ ] **Step 8: FE + seed + verify + commit** `FulfillmentsTab.tsx` (split allocator with over-allocation guardrails, fulfillment list + advance, merge same-customer picker); seed a split + a merge group. `npm run typecheck`; `npx vitest run tests/orders/` green. Commit `feat(orders): Split-merge Engine (migrations 090–091)`.

---

### Task 7: Full verification

- [ ] **Step 1:** `npm run typecheck` → clean.
- [ ] **Step 2:** FULL suite `npm run test` → all green (classify any red as orders-caused vs unrelated shared-DB flake; re-run once).
- [ ] **Step 3:** Run `npm run seed:orders` once more (idempotent) so every feature demos on papa-s-saloon.
- [ ] **Step 4:** No commit unless something was adjusted (stage by path if so).

## Self-Review notes (author)

- **Spec coverage:** F1 dashboard (T1), scaffold/registry/authz/nav (T1), F2 refund+shipment incl. full-refund coupling (T2), F3 backorder + stock consume (T3), F4 pick-pack PDF (T4), F5 SLA stage-events+trigger+targets (T5), F6 split/merge + per-fulfillment stock (T6), full verify (T7). All mapped.
- **Migration splitter hazard RESOLVED** in T5: `scripts/migrate.ts:36` treats any `$$`-containing file as one un-split statement, so the planned trigger was DROPPED. SLA now derives sale-status stages from `sales` timestamps + logs orders-specific stages in `orders_stage_events` (no trigger, no `$$`, migration budget intact: 089 sla / 090 fulfillments / 091 merge / 092 spare).
- **`logAudit` session shape** resolved via `ordersAuditSession(ctx)` (T1); implementer must match `AnySession`'s `bucket_user` arm exactly.
- **Type consistency:** wire field names (`by_status`, `sale_refunded`, `qty_fulfilled`, `over_fulfillment`, `insufficient_stock {shortfalls|have,need}`, `fulfillment:<id>` ref) are used identically across handlers, tests, and FE api.
- **Dashboard extended in-place** (T3 backorders_active, T5 sla_breaches) rather than referencing not-yet-existing tables at T1.
