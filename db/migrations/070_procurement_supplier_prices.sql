-- Migration 070: Procurement depth — supplier price history.
-- Append-only per-supplier per-product prices. The current price for a
-- (supplier, product) pair is the row with the latest effective_from <= today;
-- older rows are the history. PO lines default from the current price.
-- Distinct from product_suppliers (mig 097, alternate-vendor/risk) which holds a
-- single mutable current cost with no history.
-- Additive + idempotent. One statement per line; comments on their own line.

create table if not exists public.supplier_prices (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  supplier_id      uuid not null references public.suppliers(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  unit_cost_cents  bigint not null,
  effective_from   date not null default current_date,
  created_by       uuid references public.user_nodes(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint supplier_prices_cost_nonneg check (unit_cost_cents >= 0)
);

create index if not exists supplier_prices_lookup_idx
  on public.supplier_prices (client_id, supplier_id, product_id, effective_from desc);
