-- Migration 074: Manufacturing Kanban — board ordering, priority, and due date on
-- production orders. The FSM statuses (planned/in_progress/done/cancelled from mig
-- 058) are the board lanes; board_rank orders cards within a lane; priority + due_on
-- add scheduling signal (due_on also feeds Capacity Planning, mig 079).
-- Additive + idempotent. One statement per line; comments on their own line (Iron Rule 1).

alter table public.production_orders
  add column if not exists board_rank int not null default 0;

alter table public.production_orders
  add column if not exists priority text not null default 'normal';

alter table public.production_orders
  add column if not exists due_on date;

alter table public.production_orders
  drop constraint if exists production_orders_priority_chk;

alter table public.production_orders
  add constraint production_orders_priority_chk check (priority in ('low', 'normal', 'high'));

create index if not exists production_orders_board_idx
  on public.production_orders (client_id, status, board_rank);
