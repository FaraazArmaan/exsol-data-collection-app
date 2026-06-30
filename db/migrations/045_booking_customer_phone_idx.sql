-- 045_booking_customer_phone_idx.sql — speed up the booking customer match-or-create
-- phone lookup. Email dedupe is already enforced by user_nodes_email_per_client_idx (015).
-- Numbering 043–045 confirmed owned by Booking (POS-v2 is zero-migration; its storefront
-- spec's 043/044/045 are spec-only and will take the next free block after Booking).
CREATE INDEX IF NOT EXISTS user_nodes_client_phone_idx
  ON public.user_nodes (client_id, phone) WHERE phone IS NOT NULL;
