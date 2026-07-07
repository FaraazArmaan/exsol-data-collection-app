-- Migration 079: Manufacturing Capacity Planning — resources (work centers) with a
-- daily hours capacity, and per-order scheduling (resource + estimated hours + the
-- due_on from mig 074). Capacity = booked hours per resource per day vs hours_per_day,
-- flagging overbooked days. Additive + idempotent. Create the resources table BEFORE
-- the FK on production_orders. One statement per line; comments on their own line (Iron Rule 1).

create table if not exists public.manufacturing_resources (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  name           text not null,
  hours_per_day  int not null default 8,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint manufacturing_resources_hours_pos check (hours_per_day > 0),
  constraint manufacturing_resources_name_uniq unique (client_id, name)
);

create index if not exists manufacturing_resources_client_idx
  on public.manufacturing_resources (client_id);

alter table public.production_orders
  add column if not exists resource_id uuid references public.manufacturing_resources(id) on delete set null;

alter table public.production_orders
  add column if not exists estimated_hours int not null default 0;

alter table public.production_orders
  drop constraint if exists production_orders_est_hours_nonneg;

alter table public.production_orders
  add constraint production_orders_est_hours_nonneg check (estimated_hours >= 0);

drop trigger if exists manufacturing_resources_updated_at on public.manufacturing_resources;

create trigger manufacturing_resources_updated_at
  before update on public.manufacturing_resources
  for each row execute function public.set_updated_at();
