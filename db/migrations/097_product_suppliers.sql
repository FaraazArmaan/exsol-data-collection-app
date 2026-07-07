-- Per-product alternate suppliers: product↔supplier links with lead time, cost,
-- and a primary flag. Feeds Alternate Vendor Mgmt + Risk (lead-time / single-supplier).
create table if not exists public.product_suppliers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  lead_time_days int not null default 7,
  unit_cost_cents bigint not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_suppliers_lead_nonneg check (lead_time_days >= 0),
  constraint product_suppliers_cost_nonneg check (unit_cost_cents >= 0),
  constraint product_suppliers_uniq unique (client_id, product_id, supplier_id)
);
create index if not exists product_suppliers_client_product_idx on public.product_suppliers (client_id, product_id);
create unique index if not exists product_suppliers_one_primary_idx on public.product_suppliers (client_id, product_id) where is_primary;
create trigger product_suppliers_set_updated_at before update on public.product_suppliers for each row execute function public.set_updated_at();
