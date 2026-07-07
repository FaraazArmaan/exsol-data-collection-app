// /api/warehouse/safety-incidents
//   GET  → list incidents (?status=open|closed|all) (warehouse.business.view)
//   POST → log an incident (warehouse.business.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/safety-incidents' };

const SEVERITIES = new Set(['low', 'medium', 'high']);
const STATUSES = new Set(['open', 'closed', 'all']);

interface CreateBody {
  title?: unknown;
  severity?: unknown;
  description?: unknown;
  occurred_on?: unknown;
  location_id?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.view']);
  if (!a.ok) return a.res;
  const raw = new URL(req.url).searchParams.get('status') ?? 'all';
  const status = STATUSES.has(raw) ? raw : 'all';
  const sql = db();
  const rows = (await sql`
    SELECT i.id, to_char(i.occurred_on, 'YYYY-MM-DD') AS occurred_on,
           i.severity, i.status, i.title, i.description,
           i.location_id, l.name AS location_name, i.created_at
    FROM public.safety_incidents i
    LEFT JOIN public.warehouse_locations l ON l.id = i.location_id
    WHERE i.client_id = ${a.ctx.clientId}::uuid
      AND (${status} = 'all' OR i.status = ${status})
    ORDER BY i.occurred_on DESC, i.created_at DESC
  `) as unknown[];
  return jsonOk({ incidents: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.create']);
  if (!a.ok) return a.res;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const severity = typeof body.severity === 'string' ? body.severity.trim() : 'low';
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
  const occurredOn = typeof body.occurred_on === 'string' && body.occurred_on.trim() ? body.occurred_on.trim() : null;
  const locationId = typeof body.location_id === 'string' && body.location_id.trim() ? body.location_id.trim() : null;
  if (!title) return jsonError(400, 'title_required');
  if (!SEVERITIES.has(severity)) return jsonError(400, 'severity_invalid');

  const sql = db();
  // Only attach the location if it belongs to the caller (else drop it silently).
  let scopedLocation: string | null = null;
  if (locationId) {
    const loc = (await sql`
      SELECT id FROM public.warehouse_locations WHERE id = ${locationId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    scopedLocation = loc[0]?.id ?? null;
  }

  const rows = (await sql`
    INSERT INTO public.safety_incidents
      (client_id, occurred_on, severity, location_id, title, description, reported_by)
    VALUES (${a.ctx.clientId}::uuid, COALESCE(${occurredOn}::date, current_date), ${severity},
            ${scopedLocation}::uuid, ${title}, ${description}, ${a.ctx.userNodeId}::uuid)
    RETURNING id, to_char(occurred_on, 'YYYY-MM-DD') AS occurred_on, severity, status, title, description, location_id, created_at
  `) as Array<Record<string, unknown>>;
  return jsonOk({ incident: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
