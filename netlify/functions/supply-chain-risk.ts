import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess } from './_supply-chain-authz';
import { batchSuggestAlternates } from './_supply-chain-lib';

export const config = { path: '/api/supply-chain-risk', method: 'GET' };

type Severity = 'high' | 'medium' | 'low';
const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const sql = db();

  const tzRows = (await sql`
    SELECT timezone FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ timezone: string }>;
  const tz = tzRows[0]?.timezone ?? 'UTC';

  type RiskRow = {
    id: string;
    kind: 'single_supplier' | 'lead_time_collision' | 'overdue_po';
    severity: Severity;
    title: string;
    detail: string;
    productId?: string;
    supplierId?: string;
    poId?: string;
    suggestedAlternate?: { supplierId: string; supplierName: string; leadTimeDays: number } | null;
  };
  const risks: RiskRow[] = [];

  // 1. single_supplier: SC-active physical products (has inventory_stock OR a PO line) with ≤1 supplier link
  const singleRows = (await sql`
    WITH supplier_counts AS (
      SELECT ps.product_id, COUNT(ps.id)::int AS cnt
      FROM public.product_suppliers ps
      JOIN public.suppliers sup ON sup.id = ps.supplier_id AND sup.deleted_at IS NULL
      WHERE ps.client_id = ${clientId}::uuid
      GROUP BY ps.product_id
    ),
    active_products AS (
      SELECT DISTINCT p.id
      FROM public.products p
      LEFT JOIN public.inventory_stock inv
        ON inv.product_id = p.id AND inv.client_id = ${clientId}::uuid
      LEFT JOIN public.purchase_order_items poi ON poi.product_id = p.id
      LEFT JOIN public.purchase_orders po
        ON po.id = poi.purchase_order_id AND po.client_id = ${clientId}::uuid
      WHERE p.client_id = ${clientId}::uuid
        AND p.type = 'physical'
        AND p.deleted_at IS NULL
        AND (inv.product_id IS NOT NULL OR po.id IS NOT NULL)
    )
    SELECT p.id AS "productId", p.name,
           COALESCE(sc.cnt, 0) AS "supplierCount",
           inv.qty_on_hand AS "qtyOnHand", inv.reorder_level AS "reorderLevel"
    FROM public.products p
    JOIN active_products ap ON ap.id = p.id
    LEFT JOIN supplier_counts sc ON sc.product_id = p.id
    LEFT JOIN public.inventory_stock inv ON inv.product_id = p.id AND inv.client_id = ${clientId}::uuid
    WHERE COALESCE(sc.cnt, 0) <= 1
    ORDER BY p.name
  `) as Array<{
    productId: string;
    name: string;
    supplierCount: number | string;
    qtyOnHand: number | null;
    reorderLevel: number | null;
  }>;

  const singleProductIds = singleRows.map((r) => r.productId);
  const singleAlternates = await batchSuggestAlternates(sql, clientId, singleProductIds);

  for (const row of singleRows) {
    const count = Number(row.supplierCount);
    const hasLowStock =
      row.qtyOnHand !== null &&
      row.reorderLevel !== null &&
      row.qtyOnHand <= row.reorderLevel;
    const severity: Severity = hasLowStock ? 'high' : 'medium';
    risks.push({
      id: crypto.randomUUID(),
      kind: 'single_supplier',
      severity,
      title: `Single supplier: ${row.name}`,
      detail: `${count} supplier link — no redundancy`,
      productId: row.productId,
      suggestedAlternate: singleAlternates.get(row.productId) ?? null,
    });
  }

  // 2. lead_time_collision: low stock + primary supplier lead_time >= 14
  const ltRows = (await sql`
    SELECT p.id AS "productId", p.name,
           ps.supplier_id AS "supplierId",
           ps.lead_time_days AS "leadTimeDays",
           s.qty_on_hand AS "qtyOnHand",
           s.reorder_level AS "reorderLevel"
    FROM public.products p
    JOIN public.product_suppliers ps
      ON ps.product_id = p.id
      AND ps.client_id = ${clientId}::uuid
      AND ps.is_primary = true
    JOIN public.suppliers sup ON sup.id = ps.supplier_id AND sup.deleted_at IS NULL
    JOIN public.inventory_stock s ON s.product_id = p.id AND s.client_id = ${clientId}::uuid
    WHERE p.client_id = ${clientId}::uuid
      AND p.type = 'physical'
      AND p.deleted_at IS NULL
      AND ps.lead_time_days >= 14
      AND s.qty_on_hand <= s.reorder_level
    ORDER BY p.name
  `) as Array<{
    productId: string;
    name: string;
    supplierId: string;
    leadTimeDays: number | string;
    qtyOnHand: number | string;
    reorderLevel: number | string;
  }>;

  const ltProductIds = ltRows.map((r) => r.productId);
  const ltAlternates = await batchSuggestAlternates(sql, clientId, ltProductIds);

  for (const row of ltRows) {
    const qtyOnHand = Number(row.qtyOnHand);
    const leadTimeDays = Number(row.leadTimeDays);
    const severity: Severity = qtyOnHand === 0 ? 'high' : 'medium';
    risks.push({
      id: crypto.randomUUID(),
      kind: 'lead_time_collision',
      severity,
      title: `Long lead time: ${row.name}`,
      detail: `Low stock + ${leadTimeDays}-day lead time from primary supplier`,
      productId: row.productId,
      supplierId: row.supplierId,
      suggestedAlternate: ltAlternates.get(row.productId) ?? null,
    });
  }

  // 3. overdue_po: status='ordered' AND expected_on < today in tenant tz
  const overdueRows = (await sql`
    SELECT po.id AS "poId",
           po.supplier_id AS "supplierId",
           to_char(po.expected_on, 'YYYY-MM-DD') AS "expectedOn",
           sup.name AS "supplierName",
           ((date_trunc('day', now() AT TIME ZONE ${tz})::date - po.expected_on))::int AS "daysOverdue"
    FROM public.purchase_orders po
    JOIN public.suppliers sup ON sup.id = po.supplier_id
    WHERE po.client_id = ${clientId}::uuid
      AND po.status = 'ordered'
      AND po.expected_on < date_trunc('day', now() AT TIME ZONE ${tz})::date
    ORDER BY po.expected_on ASC
  `) as Array<{
    poId: string;
    supplierId: string;
    expectedOn: string;
    supplierName: string;
    daysOverdue: number | string;
  }>;

  for (const row of overdueRows) {
    const days = Number(row.daysOverdue);
    const severity: Severity = days > 14 ? 'high' : 'medium';
    risks.push({
      id: crypto.randomUUID(),
      kind: 'overdue_po',
      severity,
      title: `Overdue PO: ${row.supplierName}`,
      detail: `${days} day(s) overdue (expected ${row.expectedOn})`,
      poId: row.poId,
      supplierId: row.supplierId,
    });
  }

  risks.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);

  const counts = {
    high: risks.filter((r) => r.severity === 'high').length,
    medium: risks.filter((r) => r.severity === 'medium').length,
    low: risks.filter((r) => r.severity === 'low').length,
  };

  return jsonOk({ risks, counts });
}
