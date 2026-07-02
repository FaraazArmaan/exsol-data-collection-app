-- Migration 053: Inventory module — stock truth + append-only movement ledger.
-- inventory_stock holds per-product qty_on_hand + reorder_level (source of truth,
-- distinct from the legacy products.stock_qty scalar which is left untouched).
-- stock_movements is an append-only audit ledger of every qty change.
-- clients.inventory_tracking_enabled is an opt-in flag (mirrors storefront_enabled):
-- POS/storefront sale completion only decrements stock when the flag is on, so
-- legacy tenants are unaffected.
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).
-- See docs/superpowers/specs/2026-07-03-inventory-module-design.md.

create type stock_movement_type as enum ('sale', 'purchase', 'adjustment', 'production', 'transfer');

alter table public.clients
  add column if not exists inventory_tracking_enabled boolean not null default false;

create table if not exists public.inventory_stock (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id)  on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  qty_on_hand    int  not null default 0,
  reorder_level  int  not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint inventory_stock_qty_nonneg          check (qty_on_hand >= 0),
  constraint inventory_stock_reorder_nonneg      check (reorder_level >= 0),
  constraint inventory_stock_client_product_uniq unique (client_id, product_id)
);

create index if not exists inventory_stock_client_idx
  on public.inventory_stock (client_id);

create index if not exists inventory_stock_low_idx
  on public.inventory_stock (client_id) where qty_on_hand <= reorder_level;

create table if not exists public.stock_movements (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id)  on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  qty_delta    int  not null,
  type         stock_movement_type not null,
  ref          text,
  created_by   uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists stock_movements_client_product_idx
  on public.stock_movements (client_id, product_id, created_at desc);

create trigger inventory_stock_updated_at
  before update on public.inventory_stock
  for each row execute function public.set_updated_at();
