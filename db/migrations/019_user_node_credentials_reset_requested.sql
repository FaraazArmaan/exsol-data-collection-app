ALTER TABLE public.user_node_credentials
  ADD COLUMN password_reset_requested_at TIMESTAMPTZ;
-- Tracks an admin-mediated password reset request from a bucket-user.
-- NULL = no pending request. Cleared when the admin resets the password.
