# Supply Chain — DEPTH plan (feat/supply-chain-depth-iso)

**Branch:** `feat/supply-chain-depth-iso` @ base `main 00179bd` (worktree `ExSol-Analytics-WT`, ports 5192/8902).
**Migrations reserved:** 097–101 (use sequentially). **Builds on** shipped v1 (`src/modules/supply-chain/`, `netlify/functions/supply-chain-*`, `_supply-chain-authz.ts`).
**Convention deltas vs v1:** module API/types now live in `src/modules/supply-chain/shared/{api,types}.ts`; CSS uses `src/lib/theme.css` tokens ONLY (rule 9) — new CSS must too; nav via `hasDedicatedNav`/`navLinks` in the manifest.

## ZEROTH — already done (skip + log)
The 412 enable-gate exists in BOTH `_analytics-authz.ts` and `_supply-chain-authz.ts` on main (helpers `analyticsEnabled`/`supplyChainEnabled`, `412 *_module_not_enabled`, before the owner bypass). No work needed. `npm run docs:reference` may still want a rerun (final task).

## Shared change: manifest verbs (needed by F1/F4 writes)
v1 manifest is `verbs: ['view']`. Extend to `verbs: ['view','create','edit','delete']` (bucket stays `['products']`) → keys `supply-chain.products.{view,create,edit,delete}`. Extend `_supply-chain-authz.ts` with a write-capable check: keep `resolveSupplyChainAccess(req)` (view, used by the 3 read endpoints) and add `resolveSupplyChainWrite(req, requiredKey)` mirroring `_procurement-authz` (enable-gate 412 → L1 owner all-on → matrix check the key → 403). Owner bypass + enable-gate ordering unchanged.

---

## Migration 097 — `db/migrations/097_product_suppliers.sql`
Per-product alternate suppliers (feeds F1 Alternate Vendors + F2 Risk lead-time). One statement per line; comments on their own line.
```sql
-- Per-product alternate suppliers: product↔supplier links with lead time, cost,
-- and a primary flag. Feeds Alternate Vendor Mgmt + Risk (lead-time / single-supplier).
create table if not exists public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  lead_time_days int not null default 7,
  unit_cost_cents bigint not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_suppliers_lead_nonneg check (lead_time_days >= 0),
  constraint product_suppliers_cost_nonneg check (unit_cost_cents >= 0),
  constraint product_suppliers_uniq unique (client_id, product_id, supplier_id)
);
create index if not exists product_suppliers_client_product_idx on public.product_suppliers (client_id, product_id);
create unique index if not exists product_suppliers_one_primary_idx on public.product_suppliers (client_id, product_id) where is_primary;
create trigger product_suppliers_set_updated_at before update on public.product_suppliers for each row execute function public.set_updated_at();
```

## Migration 098 — `db/migrations/098_co2_emission_factors.sql`
Per-category CO2 factors (F4). `category_id IS NULL` row = client-wide default.
```sql
-- Per-category CO2 emission factors (kg CO2 per unit purchased). A null
-- category_id row is the client-wide default. CO2(PO) = sum(item.qty * factor(cat)).
create table if not exists public.co2_emission_factors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete cascade,
  kg_co2_per_unit numeric(12,3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint co2_factor_nonneg check (kg_co2_per_unit >= 0)
);
create unique index if not exists co2_factors_client_category_idx on public.co2_emission_factors (client_id, category_id) where category_id is not null;
create unique index if not exists co2_factors_client_default_idx on public.co2_emission_factors (client_id) where category_id is null;
create trigger co2_factors_set_updated_at before update on public.co2_emission_factors for each row execute function public.set_updated_at();
```
`kg_co2_per_unit` is NUMERIC → Neon returns a string → `Number()` it.

---

## Feature contracts (each = ONE commit `feat(supply-chain): <feature>`)

### F1 — Alternate Vendor & Supplier Mgmt  (mig 097)
- **`supply-chain-suppliers.ts`** — `config.path '/api/supply-chain-suppliers'` (no method → handle GET/POST/DELETE via `req.method`; DELETE uses `/api/supply-chain-suppliers/:id` name-routed to same file).
  - `GET ?product=<id>` → `{ links:[{id,supplierId,supplierName,leadTimeDays,unitCostCents,isPrimary}] }` (view key).
  - `GET` (no product) → `{ productsWithSuppliers:[{productId,name,supplierCount,primarySupplier}] }` for the management list.
  - `POST {productId,supplierId,leadTimeDays,unitCostCents,isPrimary}` → upsert (create key). Setting `isPrimary` clears others for that product (txn).
  - `DELETE /:id` → remove (delete key).
- **Switch suggestion:** helper `suggestAlternate(productId)` — if the primary supplier is risky (overdue PO or lead_time high), return the lowest-lead-time alternate. Surface in F2 risk rows + F1 UI.
- **UI:** a "Suppliers" management view under the module (new section/route) — per-product alternate list, add/remove, set-primary, mobile 560px. Theme tokens.
- **Seed:** extend `scripts/seed-supply-chain.ts` — give the SC demo products 1–2 suppliers each, one primary, varied lead times.
- **Tests:** CRUD + primary-exclusivity + authz (view vs write keys, 412 when disabled).

### F2 — Risk Analysis  (reads; no migration)
- **`supply-chain-risk.ts`** GET → `{ risks:[{id,kind,severity,title,detail,productId?,supplierId?,poId?,suggestedAlternate?}], counts:{high,medium,low} }`.
  - `single_supplier`: product with ≤1 non-deleted supplier link (severity by on-hand vs reorder).
  - `lead_time_collision`: `qty_on_hand <= reorder_level` AND primary `lead_time_days >= 14` (high if on_hand==0).
  - `overdue_po`: `status='ordered'` AND `expected_on < today` (tenant tz); severity by days overdue.
  - Severity rank order high→low; stable sort.
- **UI:** Risk panel (severity-colored, empty/loading/error), each row links to the entity; show suggested alternate where present.
- **Seed:** ensure ≥1 of each risk kind exists for papa-s-saloon.
- **Tests:** each kind detected; severity; excludes healthy; 412/403.

### F3 — Dashboard drill-downs  (reads; no migration)
- **`supply-chain-drill.ts`** GET `?type=<product-movements|po-items|production-bom>&id=<uuid>` → underlying rows for the clicked entity (validate type; tenant-scoped; 400 on bad type).
  - `product-movements`: last N `stock_movements` for the product (date, type, qty_delta, ref).
  - `po-items`: `purchase_order_items` for the PO (product name, qty, unit_cost_cents, line total).
  - `production-bom`: `bom_components` for the order's BOM (component product, qty).
- **UI:** rows in the existing InventorySection/ProcurementSection/ManufacturingSection become clickable → expandable detail (or modal), loading/empty/error, mobile.
- **Tests:** each drill type returns correct rows; tenant isolation; bad type → 400; 412/403.

### F4 — CO2 Calculator  (mig 098)
- **`supply-chain-co2.ts`** GET → `{ factors:[{id,categoryId,categoryName,kgPerUnit}], byPo:[{poId,supplier,expectedOn,kgCo2}], trend:[{day,kgCo2}] }` (view). `POST {categoryId|null,kgPerUnit}` upsert factor (edit key). CO2(PO)=Σ(item.qty × factor(product.category ?? default)).
- **UI:** CO2 panel — factor config table (editable per category + default), per-PO estimate list, 30-day trend chart (recharts). Theme tokens, mobile.
- **Seed:** insert demo factors per SC category + default.
- **Tests:** factor upsert; CO2 math with category + default fallback; trend buckets; 412/403.

### F5 — AI-SCM narrative brief  (reads; `_shared/ai.ts`)
- **`supply-chain-brief.ts`** GET → `{ brief:string, model:string, fallback:boolean, generatedAt }`. Builds a compact system+prompt from aggregates (low-stock count, open-PO value, in-progress units, top risks, 30-day CO2) and calls `ask({system,prompt,maxTokens})`. Deterministic `cannedResponse` fallback keeps tests/dev green with no key.
- **UI:** "AI brief" panel with a Generate button → renders the narrative; shows a "demo fallback" note when `fallback`. Loading/error, mobile.
- **Tests:** returns text (assert on the fallback path — no key in CI); aggregates feed the prompt; 412/403.

---

## Execution / verification
- SDD: one implementer subagent per feature + task review; one commit per feature; module tests + typecheck green each; FULL suite green before handoff.
- Every feature extends `scripts/seed-supply-chain.ts` so papa-s-saloon demos it.
- Final: `npm run typecheck` + full `npm test`; `npm run docs:reference`; handoff (migs 097/098 used; 099–101 unused/free).
- Skip-and-log rule: if a seam/dep is missing, skip, log, continue. (ZEROTH already logged as done.)
