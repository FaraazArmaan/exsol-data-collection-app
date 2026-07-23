-- Warehouse outbound execution evidence over Orders-owned fulfilment and return records.
CREATE TABLE public.warehouse_execution_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  fulfillment_id uuid REFERENCES public.orders_fulfillments(id) ON DELETE RESTRICT,
  fulfillment_line_id uuid REFERENCES public.orders_fulfillment_lines(id) ON DELETE RESTRICT,
  return_case_id uuid REFERENCES public.orders_return_cases(id) ON DELETE RESTRICT,
  return_case_line_id uuid REFERENCES public.orders_return_case_lines(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  location_id uuid REFERENCES public.warehouse_locations(id) ON DELETE RESTRICT,
  qty int NOT NULL,
  completion_evidence jsonb,
  completed_by uuid REFERENCES public.user_nodes(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT warehouse_execution_tasks_kind_chk CHECK (kind IN ('pick', 'pack', 'handoff', 'return_intake')),
  CONSTRAINT warehouse_execution_tasks_status_chk CHECK (status IN ('pending', 'in_progress', 'completed', 'exception')),
  CONSTRAINT warehouse_execution_tasks_qty_pos CHECK (qty > 0),
  CONSTRAINT warehouse_execution_tasks_origin_chk CHECK ((fulfillment_line_id IS NOT NULL AND return_case_line_id IS NULL) OR (return_case_line_id IS NOT NULL AND fulfillment_line_id IS NULL)),
  CONSTRAINT warehouse_execution_tasks_client_key_uniq UNIQUE (client_id, idempotency_key)
);
CREATE INDEX warehouse_execution_tasks_client_status_idx ON public.warehouse_execution_tasks (client_id, status, created_at DESC);
CREATE TRIGGER warehouse_execution_tasks_updated_at BEFORE UPDATE ON public.warehouse_execution_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
