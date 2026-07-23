import { timingSafeEqual } from 'node:crypto';
import { jsonError } from './_shared/http';

const TOKEN_HEADER = 'x-exsol-orders-warehouse-token';

// This is intentionally separate from a staff session. Orders calls this narrow
// contract server-to-server; a Warehouse browser session can never impersonate it.
export function requireOrdersWarehouseService(req: Request) {
  const expected = process.env.ORDERS_WAREHOUSE_SERVICE_TOKEN;
  const received = req.headers.get(TOKEN_HEADER);
  if (!expected) return { ok: false as const, res: jsonError(503, 'orders_warehouse_service_unconfigured') };
  if (!received) return { ok: false as const, res: jsonError(401, 'orders_warehouse_service_unauthorized') };
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false as const, res: jsonError(401, 'orders_warehouse_service_unauthorized') };
  return { ok: true as const };
}
