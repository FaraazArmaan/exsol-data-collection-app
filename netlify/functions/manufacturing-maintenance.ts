// /api/manufacturing/maintenance
//   GET ?kind=  → maintenance/downtime logs (manufacturing.business.view)
//   POST        → log maintenance or downtime (manufacturing.business.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/maintenance', method: ['GET', 'POST'] };

const KINDS = new Set(['maintenance', 'downtime']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.business.view']);
    if (!a.ok) return a.res;
    const raw = new URL(req.url).searchParams.get('kind') ?? 'all';
    const kind = KINDS.has(raw) ? raw : 'all';
    const sql = db();
    const logs = (await sql`
      SELECT id, kind, resource_label, reason, minutes, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, notes, created_at
      FROM public.manufacturing_maintenance_logs
      WHERE client_id = ${a.ctx.clientId}::uuid
        AND (${kind} = 'all' OR kind = ${kind})
      ORDER BY occurred_on DESC, created_at DESC
    `) as unknown[];
    return jsonOk({ logs });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.business.create']);
    if (!a.ok) return a.res;
    let body: { kind?: unknown; resource_label?: unknown; reason?: unknown; minutes?: unknown; occurred_on?: unknown; notes?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const kind = typeof body.kind === 'string' ? body.kind.trim() : 'maintenance';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const resourceLabel = typeof body.resource_label === 'string' && body.resource_label.trim() ? body.resource_label.trim() : null;
    const minutes = typeof body.minutes === 'number' ? Math.max(0, Math.trunc(body.minutes)) : 0;
    const occurredOn = typeof body.occurred_on === 'string' && body.occurred_on.trim() ? body.occurred_on.trim() : null;
    const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
    if (!KINDS.has(kind)) return jsonError(400, 'kind_invalid');
    if (!reason) return jsonError(400, 'reason_required');

    const sql = db();
    const rows = (await sql`
      INSERT INTO public.manufacturing_maintenance_logs (client_id, kind, resource_label, reason, minutes, occurred_on, notes, created_by)
      VALUES (${a.ctx.clientId}::uuid, ${kind}, ${resourceLabel}, ${reason}, ${minutes}::int,
              COALESCE(${occurredOn}::date, current_date), ${notes}, ${a.ctx.userNodeId}::uuid)
      RETURNING id, kind, resource_label, reason, minutes, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, notes, created_at
    `) as Array<Record<string, unknown>>;
    return jsonOk({ log: rows[0] }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
