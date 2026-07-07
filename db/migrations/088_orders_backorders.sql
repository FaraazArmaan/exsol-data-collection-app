-- Migration 088: orders backorder queue.
create type backorder_status as enum ('queued', 'partially_fulfilled', 'fulfilled', 'cancelled');
create table if not exists public.orders_backorders (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id)  on delete cascade,
  sale_id           uuid not null references public.sales(id)    on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  product_name_snap text not null,
  qty_ordered       int not null,
  qty_fulfilled     int not null default 0,
  status            backorder_status not null default 'queued',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  fulfilled_at      timestamptz,
  constraint orders_backorders_qty_ordered_pos check (qty_ordered > 0),
  constraint orders_backorders_qty_fulfilled_nonneg check (qty_fulfilled >= 0),
  constraint orders_backorders_qty_bound check (qty_fulfilled <= qty_ordered)
);
create index if not exists orders_backorders_client_status_idx on public.orders_backorders (client_id, status);
create trigger orders_backorders_updated_at before update on public.orders_backorders for each row execute function public.set_updated_at();
