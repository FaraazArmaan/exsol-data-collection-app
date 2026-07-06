-- Migration 058: Manufacturing module — BOMs + production orders.
-- boms declares an output product assembled from N component products.
-- production_orders run a bom `qty` times; completing one consumes component
-- stock and produces output stock via the existing stock_movements ledger
-- (type='production', already in the stock_movement_type enum from mig 053).
-- Additive + idempotent (tables/indexes guarded). One statement per line;
-- comments on their own line (Iron Rule 1).
-- See docs/superpowers/specs/2026-07-06-manufacturing-module-design.md.

create type production_order_status as enum ('planned', 'in_progress', 'done', 'cancelled');

create table if not exists public.boms (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id)  on delete cascade,
  output_product_id uuid not null references public.products(id) on delete cascade,
  name              text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists boms_client_idx
  on public.boms (client_id);

create table if not exists public.bom_components (
  id                   uuid primary key default gen_random_uuid(),
  bom_id               uuid not null references public.boms(id)     on delete cascade,
  component_product_id uuid not null references public.products(id) on delete cascade,
  qty                  int  not null,
  constraint bom_components_qty_pos      check (qty > 0),
  constraint bom_components_bom_prod_uniq unique (bom_id, component_product_id)
);

create table if not exists public.production_orders (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  bom_id       uuid not null references public.boms(id)    on delete restrict,
  qty          int  not null,
  status       production_order_status not null default 'planned',
  created_by   uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  constraint production_orders_qty_pos check (qty > 0)
);

create index if not exists production_orders_client_idx
  on public.production_orders (client_id, created_at desc);

create trigger boms_updated_at
  before update on public.boms
  for each row execute function public.set_updated_at();

create trigger production_orders_updated_at
  before update on public.production_orders
  for each row execute function public.set_updated_at();
