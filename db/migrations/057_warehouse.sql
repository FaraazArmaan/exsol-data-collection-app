-- Migration 057: Warehouse module — a locations layer over Inventory stock.
-- warehouse_locations: named stock locations per client (warehouse/store/etc).
-- stock_by_location: per-location product quantity breakdown (sums under, but is
-- tracked independently of, inventory_stock.qty_on_hand from migration 053).
-- A transfer moves qty between two locations and writes two type='transfer'
-- stock_movements rows (net-zero on the product's total on-hand). This is a thin
-- view layer over Inventory (migration 053) — no new movement type needed, since
-- 'transfer' already exists in the stock_movement_type enum.
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).
-- See spec: docs/superpowers/specs — Warehouse module (057), width slice.

create table if not exists public.warehouse_locations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  kind        text not null default 'warehouse',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint warehouse_locations_kind_chk check (kind in ('warehouse', 'store', 'storage', 'other')),
  constraint warehouse_locations_client_name_uniq unique (client_id, name)
);

create index if not exists warehouse_locations_client_idx
  on public.warehouse_locations (client_id);

create table if not exists public.stock_by_location (
  id           uuid primary key default gen_random_uuid(),
  location_id  uuid not null references public.warehouse_locations(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  qty          int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint stock_by_location_qty_nonneg check (qty >= 0),
  constraint stock_by_location_loc_product_uniq unique (location_id, product_id)
);

create index if not exists stock_by_location_location_idx
  on public.stock_by_location (location_id);

create index if not exists stock_by_location_product_idx
  on public.stock_by_location (product_id);

drop trigger if exists warehouse_locations_updated_at on public.warehouse_locations;

create trigger warehouse_locations_updated_at
  before update on public.warehouse_locations
  for each row execute function public.set_updated_at();

drop trigger if exists stock_by_location_updated_at on public.stock_by_location;

create trigger stock_by_location_updated_at
  before update on public.stock_by_location
  for each row execute function public.set_updated_at();
