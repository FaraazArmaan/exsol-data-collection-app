// GET|PUT /api/orders/sla-targets — SLA target management.
//
// GET (perm view): list the caller's client's SLA targets.
// PUT (perm edit): { targets: [{ stage, max_minutes }] } → upsert each row
//   ON CONFLICT (client_id, stage) DO UPDATE.  Returns the full list after upsert.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireOrders } from './_orders-authz';

export const config = { path: '/api/orders/sla-targets', method: ['GET', 'PUT'] };

const VALID_STAGES = [
  'pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded',
  'picking', 'packing', 'shipped', 'delivered', 'backordered',
] as const;

type OrderStage = typeof VALID_STAGES[number];

function isValidStage(s: unknown): s is OrderStage {
  return typeof s === 'string' && (VALID_STAGES as readonly string[]).includes(s);
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireOrders(req, ['orders.business.view']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;
    const sql = db();

    const rows = (await sql`
      SELECT stage::text, max_minutes
      FROM public.orders_sla_targets
      WHERE client_id = ${clientId}::uuid
      ORDER BY stage
    `) as Array<{ stage: string; max_minutes: number }>;

    return jsonOk(rows.map((r) => ({ stage: r.stage, max_minutes: Number(r.max_minutes) })));
  }

  if (req.method === 'PUT') {
    const a = await requireOrders(req, ['orders.business.edit']);
    if (!a.ok) return a.res;
    const { clientId } = a.ctx;

    let body: { targets?: unknown };
    try {
      body = await req.json();
    } catch {
      return jsonError(400, 'invalid_json');
    }

    if (!Array.isArray(body.targets)) {
      return jsonError(400, 'targets_required');
    }

    const targets = body.targets as Array<Record<string, unknown>>;
    for (const t of targets) {
      if (!isValidStage(t.stage)) return jsonError(400, 'invalid_stage', { stage: t.stage });
      if (
        typeof t.max_minutes !== 'number' ||
        !Number.isInteger(t.max_minutes) ||
        t.max_minutes < 1
      ) {
        return jsonError(400, 'invalid_max_minutes', { stage: t.stage });
      }
    }

    const sql = db();

    for (const t of targets) {
      const stage = t.stage as string;
      const maxMinutes = t.max_minutes as number;
      await sql`
        INSERT INTO public.orders_sla_targets (client_id, stage, max_minutes)
        VALUES (${clientId}::uuid, ${stage}::order_stage, ${maxMinutes})
        ON CONFLICT (client_id, stage) DO UPDATE SET max_minutes = ${maxMinutes}
      `;
    }

    const rows = (await sql`
      SELECT stage::text, max_minutes
      FROM public.orders_sla_targets
      WHERE client_id = ${clientId}::uuid
      ORDER BY stage
    `) as Array<{ stage: string; max_minutes: number }>;

    return jsonOk(rows.map((r) => ({ stage: r.stage, max_minutes: Number(r.max_minutes) })));
  }

  return new Response('Method Not Allowed', { status: 405 });
}
