-- 049_booking_customer_phone_idx.sql — speed up the booking customer match-or-create
-- phone lookup. Email dedupe is already enforced by user_nodes_email_per_client_idx (015).
-- Renumbered 045→049 at merge time (2026-06-30). Numbering: POS-v2 shipped 043–045,
-- File Manager Phase B reserves 046, Booking 047–049.
CREATE INDEX IF NOT EXISTS user_nodes_client_phone_idx
  ON public.user_nodes (client_id, phone) WHERE phone IS NOT NULL;
