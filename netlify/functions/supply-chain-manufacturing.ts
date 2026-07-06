import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-manufacturing', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();
  const rows = (await sql`
    SELECT po.id, p.name AS product, b.name AS "bomName", po.qty,
           to_char(po.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS "createdAt"
    FROM public.production_orders po
    JOIN public.boms b ON b.id = po.bom_id
    JOIN public.products p ON p.id = b.output_product_id AND p.deleted_at IS NULL
    WHERE po.client_id = ${clientId}::uuid
      AND po.status = 'in_progress'
    ORDER BY po.created_at DESC
    LIMIT 100
  `) as Array<{ id: string; product: string; bomName: string; qty: number | string; createdAt: string }>;

  const orders = rows.map((r) => ({ ...r, qty: Number(r.qty) }));
  const unitsInProduction = orders.reduce((a, r) => a + r.qty, 0);

  return jsonOk({
    kpis: { inProgressCount: orders.length, unitsInProduction },
    orders,
    generatedAt: new Date().toISOString(),
  });
}
