-- Migration 089: orders stage-event log (orders-specific stages) + SLA targets.
-- No DB trigger: sale-status stage boundaries derive from sales timestamps at read
-- time; this log captures orders-specific stages (picking/packing/shipped/delivered).
create type order_stage as enum ('pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded', 'picking', 'packing', 'shipped', 'delivered', 'backordered');
create table if not exists public.orders_stage_events (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  sale_id    uuid not null references public.sales(id)   on delete cascade,
  stage      order_stage not null,
  entered_at timestamptz not null default now(),
  source     text not null default 'orders'
);
create index if not exists orders_stage_events_sale_idx on public.orders_stage_events (client_id, sale_id, entered_at);
create table if not exists public.orders_sla_targets (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  stage       order_stage not null,
  max_minutes int not null,
  constraint orders_sla_targets_minutes_pos check (max_minutes > 0),
  constraint orders_sla_targets_client_stage_uniq unique (client_id, stage)
);
