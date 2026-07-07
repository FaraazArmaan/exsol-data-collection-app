-- Migration 087: orders refund workflow + shipment tracking (orders module).
-- Additive over sales; never forks the sale FSM.
create type refund_state as enum ('requested', 'approved', 'rejected', 'completed');
create type shipment_status as enum ('pending', 'shipped', 'in_transit', 'delivered', 'returned');
create table if not exists public.orders_refunds (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  sale_id      uuid not null references public.sales(id)   on delete cascade,
  amount_cents bigint not null,
  reason       text,
  state        refund_state not null default 'requested',
  requested_by uuid references public.user_nodes(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  constraint orders_refunds_amount_pos check (amount_cents > 0)
);
create index if not exists orders_refunds_client_sale_idx on public.orders_refunds (client_id, sale_id);
create table if not exists public.orders_shipments (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  sale_id      uuid not null references public.sales(id)   on delete cascade,
  carrier      text,
  tracking_ref text,
  status       shipment_status not null default 'pending',
  shipped_at   timestamptz,
  delivered_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists orders_shipments_client_sale_idx on public.orders_shipments (client_id, sale_id);
create trigger orders_refunds_updated_at before update on public.orders_refunds for each row execute function public.set_updated_at();
create trigger orders_shipments_updated_at before update on public.orders_shipments for each row execute function public.set_updated_at();
