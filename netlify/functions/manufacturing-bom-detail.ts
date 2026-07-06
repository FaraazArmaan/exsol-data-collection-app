// GET / PUT / DELETE a single BOM. Scoped by client_id (cross-tenant → 404).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/bom-detail/:id', method: ['GET', 'PUT', 'DELETE'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function idFrom(req: Request): string { return new URL(req.url).pathname.split('/').pop() ?? ''; }

interface CompInput { product_id: string; qty: number; }
function parseComponents(raw: unknown): CompInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CompInput[] = [];
  for (const c of raw) {
    const pid = typeof (c as any)?.product_id === 'string' ? (c as any).product_id.trim() : '';
    const qty = typeof (c as any)?.qty === 'number' ? Math.trunc((c as any).qty) : NaN;
    if (!pid || !Number.isFinite(qty) || qty <= 0) return null;
    out.push({ product_id: pid, qty });
  }
  return out;
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFrom(req);
  if (!UUID_RE.test(id)) return jsonError(404, 'not_found');

  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const head = (await sql`
      SELECT b.id, b.name, b.output_product_id, p.name AS output_product_name
      FROM public.boms b JOIN public.products p ON p.id = b.output_product_id
      WHERE b.id = ${id}::uuid AND b.client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    if (!head[0]) return jsonError(404, 'not_found');
    const components = (await sql`
      SELECT bc.component_product_id, p.name, bc.qty
      FROM public.bom_components bc JOIN public.products p ON p.id = bc.component_product_id
      WHERE bc.bom_id = ${id}::uuid
      ORDER BY p.name ASC
    `) as unknown[];
    return jsonOk({ ...head[0], components });
  }

  if (req.method === 'PUT') {
    const a = await requireManufacturing(req, ['manufacturing.products.edit']);
    if (!a.ok) return a.res;
    let body: { name?: unknown; components?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const comps = parseComponents(body.components);
    if (!comps) return jsonError(400, 'components_required');
    // Reject duplicate component product_ids up front — before any DB write.
    const pidSet = new Set(comps.map((c) => c.product_id));
    if (pidSet.size !== comps.length) return jsonError(400, 'duplicate_component');
    // Guard malformed UUIDs before they reach Postgres (22P02 → 500).
    for (const c of comps) if (!UUID_RE.test(c.product_id)) return jsonError(404, 'component_product_not_found');
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;

    const sql = db();
    const owned = (await sql`
      SELECT id FROM public.boms WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    if (!owned[0]) return jsonError(404, 'not_found');

    const ids = comps.map((c) => c.product_id);
    const ownedProd = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL AND id = ANY(${ids}::uuid[])
    `) as Array<{ id: string }>;
    const ownedSet = new Set(ownedProd.map((r) => r.id));
    for (const c of comps) if (!ownedSet.has(c.product_id)) return jsonError(404, 'component_product_not_found');

    try {
      await sql.transaction([
        sql`DELETE FROM public.bom_components WHERE bom_id = ${id}::uuid`,
        ...comps.map((c) => sql`
          INSERT INTO public.bom_components (bom_id, component_product_id, qty)
          VALUES (${id}::uuid, ${c.product_id}::uuid, ${c.qty}::int)
        `),
        sql`UPDATE public.boms SET name = COALESCE(${name ?? null}, name), updated_at = now() WHERE id = ${id}::uuid`,
      ]);
    } catch (e: any) {
      if (e?.code === '23505') return jsonError(400, 'duplicate_component');
      throw e;
    }
    return jsonOk({ id });
  }

  if (req.method !== 'DELETE') return new Response('Method Not Allowed', { status: 405 });
  // DELETE — blocked if any production order references the BOM (FK RESTRICT).
  const a = await requireManufacturing(req, ['manufacturing.products.delete']);
  if (!a.ok) return a.res;
  const sql = db();
  const inUse = (await sql`
    SELECT 1 FROM public.production_orders
    WHERE bom_id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
  `) as unknown[];
  if (inUse.length > 0) return jsonError(409, 'bom_in_use');
  const rows = (await sql`
    DELETE FROM public.boms WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid RETURNING id
  `) as any[];
  if (!rows[0]) return jsonError(404, 'not_found');
  return jsonOk({ id: rows[0].id, deleted: true });
}
