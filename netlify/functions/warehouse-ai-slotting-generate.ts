// POST /api/warehouse/ai-slotting-generate — refresh AI slotting suggestions.
// Candidates are DERIVED DETERMINISTICALLY: products whose stock sits in a
// non-store location, ranked by recent movement velocity — so the recommendation
// is grounded in data, not a hallucination. lib/ai.ts then writes the natural
// language rationale (keyless dev fallback keeps it demoable). Nothing moves until
// a human applies a suggestion. (warehouse.products.edit)
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';
import { ask } from './_shared/ai';

export const config = { path: '/api/warehouse/ai-slotting-generate', method: 'POST' };

const MAX_SUGGESTIONS = 4;

interface Candidate {
  product_id: string;
  product_name: string;
  from_location_id: string;
  from_name: string;
  from_kind: string;
  to_location_id: string;
  to_name: string;
  source_qty: number;
  velocity: number;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireWarehouse(req, ['warehouse.products.edit']);
  if (!a.ok) return a.res;

  const sql = db();
  const candidates = (await sql`
    WITH velocity AS (
      -- Demand signal only: count 'sale' movements, NOT 'transfer'. Applied
      -- slotting writes a net-zero transfer pair whose abs() would otherwise feed
      -- back and inflate the same product's ranking by 2×qty each time.
      SELECT product_id, coalesce(sum(abs(qty_delta)), 0)::int AS vel
      FROM public.stock_movements
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND type = 'sale'
        AND created_at > now() - interval '90 days'
      GROUP BY product_id
    ),
    store AS (
      SELECT id, name FROM public.warehouse_locations
      WHERE client_id = ${a.ctx.clientId}::uuid AND kind = 'store'
      ORDER BY created_at ASC LIMIT 1
    )
    SELECT sbl.product_id, p.name AS product_name,
           sbl.location_id AS from_location_id, fl.name AS from_name, fl.kind AS from_kind,
           (SELECT id FROM store) AS to_location_id, (SELECT name FROM store) AS to_name,
           sbl.qty AS source_qty, coalesce(v.vel, 0)::int AS velocity
    FROM public.stock_by_location sbl
    JOIN public.warehouse_locations fl ON fl.id = sbl.location_id
    JOIN public.products p ON p.id = sbl.product_id
    LEFT JOIN velocity v ON v.product_id = sbl.product_id
    WHERE fl.client_id = ${a.ctx.clientId}::uuid
      AND fl.kind <> 'store'
      AND sbl.qty > 0
      AND (SELECT id FROM store) IS NOT NULL
    ORDER BY coalesce(v.vel, 0) DESC, sbl.qty DESC
    LIMIT ${MAX_SUGGESTIONS}
  `) as Candidate[];

  // Refresh the pending set (applied/dismissed history is preserved).
  await sql`
    DELETE FROM public.warehouse_slotting_suggestions
    WHERE client_id = ${a.ctx.clientId}::uuid AND status = 'pending'
  `;

  let anyFallback = false;
  let created = 0;
  for (const c of candidates) {
    const qty = Math.min(c.source_qty, Math.max(1, Math.ceil(c.source_qty / 2)));
    const { text, fallback } = await ask({
      system: 'You are a warehouse slotting advisor. In ONE short sentence, explain why moving some units to the pick-face store location speeds up fulfilment. No preamble.',
      prompt: `Product "${c.product_name}" had ${c.velocity} units of movement in the last 90 days. ${c.source_qty} units currently sit in "${c.from_name}" (${c.from_kind}). Recommend moving ${qty} units to the store location "${c.to_name}".`,
      maxTokens: 120,
    });
    if (fallback) anyFallback = true;
    await sql`
      INSERT INTO public.warehouse_slotting_suggestions
        (client_id, product_id, from_location_id, to_location_id, suggested_qty, velocity, rationale, ai_fallback)
      VALUES (${a.ctx.clientId}::uuid, ${c.product_id}::uuid, ${c.from_location_id}::uuid,
              ${c.to_location_id}::uuid, ${qty}::int, ${c.velocity}::int, ${text.slice(0, 600)}, ${fallback})
    `;
    created++;
  }

  return jsonOk({ created, ai_fallback: created > 0 ? anyFallback : false });
}
