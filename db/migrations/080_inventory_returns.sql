-- Migration 080: Inventory Returns & RMA.
-- Adds 'return' and 'writeoff' to the stock_movement_type enum, plus an
-- inventory_returns table recording a customer return intake with a
-- restock/writeoff disposition. A restock adds units back to stock via a
-- 'return' movement; a writeoff records the scrap via a 'writeoff' movement.
-- The enum values are only added here (not used in this migration), so the
-- ADD VALUE statements are transaction-safe on PG12+.
-- Additive + idempotent. One statement per line; comments on their own line.

alter type stock_movement_type add value if not exists 'return';

alter type stock_movement_type add value if not exists 'writeoff';

create table if not exists public.inventory_returns (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  qty          int not null,
  disposition  text not null,
  reason       text,
  created_by   uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint inventory_returns_qty_pos          check (qty > 0),
  constraint inventory_returns_disposition_chk  check (disposition in ('restock', 'writeoff'))
);

create index if not exists inventory_returns_client_idx
  on public.inventory_returns (client_id, created_at desc);
