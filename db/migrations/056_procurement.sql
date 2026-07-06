-- Migration 056: Procurement module — suppliers + purchase orders.
-- suppliers is a per-client contact list. purchase_orders is an FSM
-- (draft -> ordered -> received -> cancelled); purchase_order_items are its lines.
-- Receiving a PO (handled in code) increments inventory_stock and writes a
-- stock_movements row of type 'purchase' — so Procurement depends on the
-- Inventory module (migration 053). No runtime feature flag: receiving is an
-- explicit user action, gated only by the module enablement.
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).
-- See docs/superpowers/specs/2026-07-06-procurement-module-design.md.

create type purchase_order_status as enum ('draft', 'ordered', 'received', 'cancelled');

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint suppliers_name_len check (char_length(name) between 1 and 160)
);

create index if not exists suppliers_client_idx
  on public.suppliers (client_id) where deleted_at is null;

create table if not exists public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete restrict,
  status       purchase_order_status not null default 'draft',
  expected_on  date,
  notes        text,
  created_by   uuid references public.user_nodes(id) on delete set null,
  received_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists purchase_orders_client_status_idx
  on public.purchase_orders (client_id, status);

create index if not exists purchase_orders_client_created_idx
  on public.purchase_orders (client_id, created_at desc);

create table if not exists public.purchase_order_items (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  product_id         uuid not null references public.products(id) on delete restrict,
  qty                int not null,
  unit_cost_cents    bigint not null default 0,
  created_at         timestamptz not null default now(),
  constraint purchase_order_items_qty_pos      check (qty > 0),
  constraint purchase_order_items_cost_nonneg  check (unit_cost_cents >= 0)
);

create index if not exists purchase_order_items_po_idx
  on public.purchase_order_items (purchase_order_id);

create trigger suppliers_updated_at
  before update on public.suppliers
  for each row execute function public.set_updated_at();

create trigger purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute function public.set_updated_at();
