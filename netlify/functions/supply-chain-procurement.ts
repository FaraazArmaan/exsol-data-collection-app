import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';

export const config = { path: '/api/supply-chain-procurement', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();
  const rows = (await sql`
    SELECT po.id, s.name AS supplier, po.status,
           to_char(po.expected_on, 'YYYY-MM-DD') AS "expectedOn",
           COALESCE(li.item_count, 0) AS "itemCount",
           COALESCE(li.total_cents, 0) AS "totalCents"
    FROM public.purchase_orders po
    JOIN public.suppliers s ON s.id = po.supplier_id
    LEFT JOIN (
      SELECT purchase_order_id,
             count(*)::int AS item_count,
             sum(qty * unit_cost_cents)::bigint AS total_cents
      FROM public.purchase_order_items
      GROUP BY purchase_order_id
    ) li ON li.purchase_order_id = po.id
    WHERE po.client_id = ${clientId}::uuid
      AND po.status = 'ordered'
    ORDER BY po.expected_on ASC NULLS LAST, po.created_at DESC
    LIMIT 100
  `) as Array<{
    id: string; supplier: string; status: string; expectedOn: string | null;
    itemCount: number | string; totalCents: number | string;
  }>;

  const openPos = rows.map((r) => ({
    id: r.id, supplier: r.supplier, status: r.status, expectedOn: r.expectedOn,
    itemCount: Number(r.itemCount), totalCents: Number(r.totalCents),
  }));
  const openValueCents = openPos.reduce((a, r) => a + r.totalCents, 0);

  return jsonOk({
    kpis: { openPoCount: openPos.length, openValueCents },
    openPos,
    generatedAt: new Date().toISOString(),
  });
}
