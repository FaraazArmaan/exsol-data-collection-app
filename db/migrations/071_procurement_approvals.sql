-- Migration 071: Procurement depth — vendor approvals.
-- Adds a 'pending_approval' PO status (transaction-safe ADD VALUE), approval-stamp
-- columns, and a per-client approval threshold (0 = no approval required). A PO
-- whose total >= threshold routes draft -> pending_approval -> ordered instead of
-- draft -> ordered.
-- Additive + idempotent. One statement per line; comments on their own line.

alter type purchase_order_status add value if not exists 'pending_approval';

alter table public.purchase_orders
  add column if not exists submitted_at timestamptz;

alter table public.purchase_orders
  add column if not exists approved_by uuid references public.user_nodes(id) on delete set null;

alter table public.purchase_orders
  add column if not exists approved_at timestamptz;

alter table public.clients
  add column if not exists po_approval_threshold_cents bigint not null default 0;
