-- Migration 091: orders merge groups (link same-customer open orders for combined pick-pack).
create table if not exists public.orders_merge_groups (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  primary_sale_id uuid not null references public.sales(id)   on delete cascade,
  customer_key    text not null,
  created_at      timestamptz not null default now()
);
create table if not exists public.orders_merge_members (
  id       uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.orders_merge_groups(id) on delete cascade,
  sale_id  uuid not null references public.sales(id) on delete cascade,
  constraint orders_merge_members_uniq unique (group_id, sale_id)
);
create index if not exists orders_merge_groups_client_idx on public.orders_merge_groups (client_id);
