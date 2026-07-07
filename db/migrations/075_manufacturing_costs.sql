-- Migration 075: Manufacturing product unit costs — the basis for BOM cost rollup
-- and scrap valuation. No product/inventory table carries a standing cost (only
-- purchase_order_items.unit_cost_cents exists, per receipt), so manufacturing owns
-- its own per-product cost, seedable from the latest PO cost and editable in the
-- BOM Designer. Rollup = sum(component unit_cost_cents * component qty).
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.manufacturing_product_costs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  product_id       uuid not null references public.products(id) on delete cascade,
  unit_cost_cents  bigint not null default 0,
  updated_at       timestamptz not null default now(),
  constraint manufacturing_product_costs_nonneg check (unit_cost_cents >= 0),
  constraint manufacturing_product_costs_uniq unique (client_id, product_id)
);

create index if not exists manufacturing_product_costs_client_idx
  on public.manufacturing_product_costs (client_id);

drop trigger if exists manufacturing_product_costs_updated_at on public.manufacturing_product_costs;

create trigger manufacturing_product_costs_updated_at
  before update on public.manufacturing_product_costs
  for each row execute function public.set_updated_at();
