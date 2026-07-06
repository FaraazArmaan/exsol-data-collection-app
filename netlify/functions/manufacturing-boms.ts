// GET list + POST create for BOMs. Every query scoped by client_id.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/boms', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CreateBody { name?: unknown; output_product_id?: unknown; components?: unknown; }
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
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const items = (await sql`
      SELECT b.id, b.name, b.output_product_id, p.name AS output_product_name,
             b.created_at,
             (SELECT COUNT(*)::int FROM public.bom_components bc WHERE bc.bom_id = b.id) AS component_count
      FROM public.boms b
      JOIN public.products p ON p.id = b.output_product_id
      WHERE b.client_id = ${a.ctx.clientId}::uuid
      ORDER BY b.created_at DESC
    `) as unknown[];
    return jsonOk({ items });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.products.create']);
    if (!a.ok) return a.res;
    let body: CreateBody;
    try { body = (await req.json()) as CreateBody; } catch { return jsonError(400, 'invalid_json'); }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const outputId = typeof body.output_product_id === 'string' ? body.output_product_id.trim() : '';
    const comps = parseComponents(body.components);
    if (!name) return jsonError(400, 'name_required');
    if (!outputId) return jsonError(400, 'output_product_id_required');
    if (!comps) return jsonError(400, 'components_required');
    // Reject duplicate component product_ids up front — before any DB write.
    const pidSet = new Set(comps.map((c) => c.product_id));
    if (pidSet.size !== comps.length) return jsonError(400, 'duplicate_component');
    // Guard malformed UUIDs before they reach Postgres (22P02 → 500).
    if (!UUID_RE.test(outputId)) return jsonError(404, 'output_product_not_found');
    for (const c of comps) if (!UUID_RE.test(c.product_id)) return jsonError(404, 'component_product_not_found');

    const sql = db();
    // All referenced products (output + components) must belong to this client.
    const ids = [outputId, ...comps.map((c) => c.product_id)];
    const owned = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL AND id = ANY(${ids}::uuid[])
    `) as Array<{ id: string }>;
    const ownedSet = new Set(owned.map((r) => r.id));
    if (!ownedSet.has(outputId)) return jsonError(404, 'output_product_not_found');
    for (const c of comps) if (!ownedSet.has(c.product_id)) return jsonError(404, 'component_product_not_found');

    // Atomic create: generate id in JS, insert header + components in one transaction.
    const bomId = crypto.randomUUID();
    try {
      await sql.transaction([
        sql`INSERT INTO public.boms (id, client_id, output_product_id, name)
            VALUES (${bomId}::uuid, ${a.ctx.clientId}::uuid, ${outputId}::uuid, ${name})`,
        ...comps.map((c) => sql`
          INSERT INTO public.bom_components (bom_id, component_product_id, qty)
          VALUES (${bomId}::uuid, ${c.product_id}::uuid, ${c.qty}::int)
        `),
      ]);
    } catch (e: any) {
      if (e?.code === '23505') return jsonError(400, 'duplicate_component');
      throw e;
    }
    return jsonOk({ id: bomId }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
