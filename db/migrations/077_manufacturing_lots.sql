-- Migration 077: Manufacturing Part Tracking — lot/batch traceability. When a
-- production order consumes components, the lot/batch refs of those components are
-- recorded here, so a finished order can be traced back to the exact lots that went
-- into it (recall support), and a lot can be traced forward to every order it fed.
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.manufacturing_consumption_lots (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  production_order_id   uuid not null references public.production_orders(id) on delete cascade,
  component_product_id  uuid not null references public.products(id) on delete cascade,
  lot_ref               text not null,
  qty                   int  not null,
  created_at            timestamptz not null default now(),
  constraint manufacturing_lots_qty_pos check (qty > 0),
  constraint manufacturing_lots_ref_len check (char_length(lot_ref) between 1 and 120)
);

create index if not exists manufacturing_lots_order_idx
  on public.manufacturing_consumption_lots (client_id, production_order_id);

create index if not exists manufacturing_lots_ref_idx
  on public.manufacturing_consumption_lots (client_id, lot_ref);
