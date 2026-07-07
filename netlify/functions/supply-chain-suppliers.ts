import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveSupplyChainAccess, resolveSupplyChainWrite } from './_supply-chain-authz';
import { suggestAlternate } from './_supply-chain-lib';

// Array form so both the list route and the /:id DELETE route dispatch to this function.
export const config = { path: ['/api/supply-chain-suppliers', '/api/supply-chain-suppliers/:id'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  if (req.method === 'DELETE') return handleDelete(req);
  return jsonError(405, 'method_not_allowed');
}

async function handleGet(req: Request): Promise<Response> {
  const auth = await resolveSupplyChainAccess(req);
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  const url = new URL(req.url);
  const productId = url.searchParams.get('product');
  const sql = db();

  if (productId) {
    const links = (await sql`
      SELECT ps.id,
             ps.supplier_id AS "supplierId",
             s.name AS "supplierName",
             ps.lead_time_days AS "leadTimeDays",
             ps.unit_cost_cents AS "unitCostCents",
             ps.is_primary AS "isPrimary"
      FROM public.product_suppliers ps
      JOIN public.suppliers s ON s.id = ps.supplier_id AND s.deleted_at IS NULL
      WHERE ps.client_id = ${clientId}::uuid
        AND ps.product_id = ${productId}::uuid
      ORDER BY ps.is_primary DESC, s.name
    `) as Array<{
      id: string; supplierId: string; supplierName: string;
      leadTimeDays: number; unitCostCents: string; isPrimary: boolean;
    }>;
    const suggestedAlternate = await suggestAlternate(sql, clientId, productId);
    return jsonOk({ links: links.map((r) => ({ ...r, unitCostCents: Number(r.unitCostCents) })), suggestedAlternate });
  }

  const rows = (await sql`
    SELECT p.id AS "productId",
           p.name,
           count(ps.id)::int AS "supplierCount",
           max(s.name) FILTER (WHERE ps.is_primary) AS "primarySupplier"
    FROM public.products p
    LEFT JOIN public.product_suppliers ps
      ON ps.product_id = p.id AND ps.client_id = ${clientId}::uuid
    LEFT JOIN public.suppliers s ON s.id = ps.supplier_id AND s.deleted_at IS NULL
    WHERE p.client_id = ${clientId}::uuid AND p.deleted_at IS NULL
    GROUP BY p.id, p.name
    HAVING count(ps.id) > 0
    ORDER BY p.name
  `) as Array<{
    productId: string; name: string; supplierCount: number; primarySupplier: string | null;
  }>;
  return jsonOk({ productsWithSuppliers: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const auth = await resolveSupplyChainWrite(req, 'supply-chain.products.create');
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  let body: unknown;
  try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
  const { productId, supplierId, leadTimeDays, unitCostCents, isPrimary } = body as Record<string, unknown>;

  if (!productId || typeof productId !== 'string') return jsonError(400, 'missing_product_id');
  if (!supplierId || typeof supplierId !== 'string') return jsonError(400, 'missing_supplier_id');
  if (typeof leadTimeDays !== 'number' || leadTimeDays < 0) return jsonError(400, 'invalid_lead_time_days');
  if (typeof unitCostCents !== 'number' || unitCostCents < 0) return jsonError(400, 'invalid_unit_cost_cents');

  const primary = isPrimary === true;
  const sql = db();

  // Verify product + supplier belong to this client.
  const prodCheck = (await sql`
    SELECT id FROM public.products WHERE id = ${productId}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL LIMIT 1
  `) as Array<{ id: string }>;
  if (prodCheck.length === 0) return jsonError(404, 'product_not_found');

  const suppCheck = (await sql`
    SELECT id FROM public.suppliers WHERE id = ${supplierId}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL LIMIT 1
  `) as Array<{ id: string }>;
  if (suppCheck.length === 0) return jsonError(404, 'supplier_not_found');

  if (primary) {
    // Clear existing primary for this product before upsert to avoid index conflict.
    await sql`
      UPDATE public.product_suppliers
         SET is_primary = false
       WHERE client_id = ${clientId}::uuid AND product_id = ${productId}::uuid AND is_primary = true
    `;
  }

  const rows = (await sql`
    INSERT INTO public.product_suppliers (client_id, product_id, supplier_id, lead_time_days, unit_cost_cents, is_primary)
    VALUES (${clientId}::uuid, ${productId}::uuid, ${supplierId}::uuid, ${leadTimeDays}::int, ${unitCostCents}::bigint, ${primary})
    ON CONFLICT (client_id, product_id, supplier_id) DO UPDATE
      SET lead_time_days = EXCLUDED.lead_time_days,
          unit_cost_cents = EXCLUDED.unit_cost_cents,
          is_primary = EXCLUDED.is_primary
    RETURNING id, lead_time_days AS "leadTimeDays", unit_cost_cents AS "unitCostCents", is_primary AS "isPrimary"
  `) as Array<{ id: string; leadTimeDays: number; unitCostCents: string; isPrimary: boolean }>;

  const row = rows[0]!;
  return jsonOk(
    { id: row.id, productId, supplierId, leadTimeDays: row.leadTimeDays, unitCostCents: Number(row.unitCostCents), isPrimary: row.isPrimary },
    { status: 201 },
  );
}

async function handleDelete(req: Request): Promise<Response> {
  const auth = await resolveSupplyChainWrite(req, 'supply-chain.products.delete');
  if (!auth.ok) return auth.res;
  const { clientId } = auth.access;

  // Extract id from URL path: /api/supply-chain-suppliers/<id>
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const id = segments[segments.length - 1];
  if (!id || id === 'supply-chain-suppliers') return jsonError(400, 'missing_id');

  const sql = db();
  const rows = (await sql`
    DELETE FROM public.product_suppliers
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid
    RETURNING id
  `) as Array<{ id: string }>;
  if (rows.length === 0) return jsonError(404, 'not_found');
  return jsonOk({ id });
}
