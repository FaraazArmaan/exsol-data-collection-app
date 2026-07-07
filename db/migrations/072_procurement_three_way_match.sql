-- Migration 072: Procurement depth — 3-way match (GRN + supplier invoices).
-- goods_receipts/_items record what physically arrived; supplier_invoices record
-- what was billed. A clean 3-way match (ordered qty == received qty per line and
-- PO total == invoiced total) can be confirmed, which creates a Finance expense
-- and links it back on the PO (finance_expense_id).
-- Additive + idempotent. One statement per line; comments on their own line.

create table if not exists public.goods_receipts (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  received_on        date not null default current_date,
  note               text,
  created_by         uuid references public.user_nodes(id) on delete set null,
  created_at         timestamptz not null default now()
);

create index if not exists goods_receipts_po_idx on public.goods_receipts (purchase_order_id);

create table if not exists public.goods_receipt_items (
  id                uuid primary key default gen_random_uuid(),
  goods_receipt_id  uuid not null references public.goods_receipts(id) on delete cascade,
  product_id        uuid not null references public.products(id) on delete restrict,
  qty_received      int not null,
  created_at        timestamptz not null default now(),
  constraint goods_receipt_items_qty_pos check (qty_received > 0)
);

create index if not exists goods_receipt_items_grn_idx on public.goods_receipt_items (goods_receipt_id);

create table if not exists public.supplier_invoices (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  invoice_number     text not null,
  amount_cents       bigint not null,
  invoice_date       date not null default current_date,
  created_by         uuid references public.user_nodes(id) on delete set null,
  created_at         timestamptz not null default now(),
  constraint supplier_invoices_amount_nonneg check (amount_cents >= 0)
);

create index if not exists supplier_invoices_po_idx on public.supplier_invoices (purchase_order_id);

alter table public.purchase_orders
  add column if not exists finance_expense_id uuid references public.finance_expenses(id) on delete set null;
