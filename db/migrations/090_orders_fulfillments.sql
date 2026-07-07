-- Migration 090: orders fulfillments (split a sale's lines into shippable groups).
create type fulfillment_status as enum ('pending', 'picked', 'packed', 'shipped', 'fulfilled', 'cancelled');
create table if not exists public.orders_fulfillments (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  sale_id      uuid not null references public.sales(id)   on delete cascade,
  label        text not null,
  status       fulfillment_status not null default 'pending',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  fulfilled_at timestamptz
);
create index if not exists orders_fulfillments_client_sale_idx on public.orders_fulfillments (client_id, sale_id);
create table if not exists public.orders_fulfillment_lines (
  id             uuid primary key default gen_random_uuid(),
  fulfillment_id uuid not null references public.orders_fulfillments(id) on delete cascade,
  sale_line_id   uuid not null references public.sale_lines(id) on delete restrict,
  qty            int not null,
  constraint orders_fulfillment_lines_qty_pos check (qty > 0),
  constraint orders_fulfillment_lines_uniq unique (fulfillment_id, sale_line_id)
);
create trigger orders_fulfillments_updated_at before update on public.orders_fulfillments for each row execute function public.set_updated_at();
