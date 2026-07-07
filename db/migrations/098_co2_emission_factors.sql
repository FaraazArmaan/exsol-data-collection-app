-- Per-category CO2 emission factors (kg CO2 per unit purchased). A null
-- category_id row is the client-wide default. CO2(PO) = sum(item.qty * factor(cat)).
create table if not exists public.co2_emission_factors (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  category_id uuid references public.product_categories(id) on delete cascade,
  kg_co2_per_unit numeric(12,3) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint co2_factor_nonneg check (kg_co2_per_unit >= 0)
);
create unique index if not exists co2_factors_client_category_idx on public.co2_emission_factors (client_id, category_id) where category_id is not null;
create unique index if not exists co2_factors_client_default_idx on public.co2_emission_factors (client_id) where category_id is null;
create trigger co2_factors_set_updated_at before update on public.co2_emission_factors for each row execute function public.set_updated_at();
