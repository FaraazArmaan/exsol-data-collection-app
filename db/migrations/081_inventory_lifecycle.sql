-- Migration 081: Inventory lifecycle state.
-- Per-product lifecycle: active / seasonal / discontinued. Discontinuing an item
-- also hides it from the storefront (products.storefront_visible = false),
-- handled in the endpoint. Additive + idempotent. One statement per line.

alter table public.inventory_stock
  add column if not exists lifecycle_state text not null default 'active';

alter table public.inventory_stock
  drop constraint if exists inventory_stock_lifecycle_chk;

alter table public.inventory_stock
  add constraint inventory_stock_lifecycle_chk check (lifecycle_state in ('active', 'seasonal', 'discontinued'));

create index if not exists inventory_stock_lifecycle_idx
  on public.inventory_stock (client_id, lifecycle_state);
