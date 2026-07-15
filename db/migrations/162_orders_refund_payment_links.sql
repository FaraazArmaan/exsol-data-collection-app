-- Link provider refund ledger entries to both the Orders request and its original capture.
ALTER TABLE public.payment_transactions ADD COLUMN orders_refund_id UUID REFERENCES public.orders_refunds(id) ON DELETE RESTRICT;
ALTER TABLE public.payment_transactions ADD COLUMN refund_of_transaction_id UUID REFERENCES public.payment_transactions(id) ON DELETE RESTRICT;
ALTER TABLE public.payment_transactions ADD CONSTRAINT payment_transactions_refund_link_check CHECK ((kind = 'provider_refunded' AND orders_refund_id IS NOT NULL AND refund_of_transaction_id IS NOT NULL AND provider IS NOT NULL) OR (kind <> 'provider_refunded' AND orders_refund_id IS NULL AND refund_of_transaction_id IS NULL));
CREATE INDEX payment_transactions_orders_refund_idx ON public.payment_transactions (orders_refund_id, created_at DESC);
CREATE INDEX payment_transactions_refund_origin_idx ON public.payment_transactions (refund_of_transaction_id, created_at DESC);
