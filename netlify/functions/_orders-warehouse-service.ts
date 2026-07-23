export type WarehouseEvidence = {
  task_id: string;
  fulfillment_id: string | null;
  fulfillment_line_id: string | null;
  return_case_id: string | null;
  return_case_line_id: string | null;
  kind: 'pick' | 'pack' | 'handoff' | 'return_intake';
  outcome: 'completed' | 'exception';
  completed_quantity: number;
  evidence: Record<string, unknown> | null;
  actor_id: string | null;
  completed_at: string;
  correlation_id: string;
  location_id: string | null;
};

type WarehouseResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

function token(): string | null {
  return process.env.ORDERS_WAREHOUSE_SERVICE_TOKEN || null;
}

async function call<T>(request: Request, path: string, init?: RequestInit): Promise<WarehouseResult<T>> {
  const serviceToken = token();
  if (!serviceToken) return { ok: false, status: 503, code: 'warehouse_service_unconfigured' };
  const response = await fetch(new URL(path, request.url), {
    ...init,
    headers: { 'content-type': 'application/json', 'x-exsol-orders-warehouse-token': serviceToken, ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => null) as { error?: { code?: string } } & T;
  if (!response.ok) return { ok: false, status: response.status, code: body?.error?.code ?? 'warehouse_service_error' };
  return { ok: true, value: body };
}

export function requestWarehouseTask(request: Request, body: Record<string, unknown>) {
  return call<{ task: Record<string, unknown>; replayed: boolean }>(request, '/api/internal/orders/warehouse-execution-tasks', { method: 'POST', body: JSON.stringify(body) });
}

export function readWarehouseEvidence(request: Request, clientId: string, line: { fulfillment_line_id?: string; return_case_line_id?: string }) {
  const query = new URLSearchParams({ client_id: clientId, ...line });
  return call<{ evidence: WarehouseEvidence[] }>(request, `/api/internal/orders/warehouse-execution-tasks?${query}`);
}
