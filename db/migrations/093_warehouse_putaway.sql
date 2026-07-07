-- Migration 093: Warehouse Putaway Tasks — the receiving-dock → bin queue.
-- When a purchase order is received (Procurement, migration 056) the goods land
-- in inventory_stock (total on-hand) but are not yet allocated to a warehouse
-- location. A putaway task represents "this received line needs a home"; confirming
-- it increments stock_by_location and writes a type='transfer' movement (net-zero
-- on total on-hand, since receipt already counted it). Depends on warehouse (057)
-- and procurement (056).
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.warehouse_putaway_tasks (
  id                     uuid primary key default gen_random_uuid(),
  client_id              uuid not null references public.clients(id) on delete cascade,
  purchase_order_id      uuid references public.purchase_orders(id) on delete set null,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  product_id             uuid not null references public.products(id) on delete cascade,
  qty                    int  not null,
  status                 text not null default 'pending',
  location_id            uuid references public.warehouse_locations(id) on delete set null,
  done_by                uuid references public.user_nodes(id) on delete set null,
  done_at                timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint warehouse_putaway_status_chk check (status in ('pending', 'done', 'cancelled')),
  constraint warehouse_putaway_qty_pos check (qty > 0)
);

create index if not exists warehouse_putaway_client_status_idx
  on public.warehouse_putaway_tasks (client_id, status);

create unique index if not exists warehouse_putaway_po_item_uniq
  on public.warehouse_putaway_tasks (purchase_order_item_id)
  where purchase_order_item_id is not null;

drop trigger if exists warehouse_putaway_updated_at on public.warehouse_putaway_tasks;

create trigger warehouse_putaway_updated_at
  before update on public.warehouse_putaway_tasks
  for each row execute function public.set_updated_at();
