ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_template_chk;
ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_template_chk CHECK (template IN ('booking_confirmation', 'storefront_receipt', 'order_handoff'));
