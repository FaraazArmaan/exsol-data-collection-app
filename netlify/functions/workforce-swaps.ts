// /api/workforce/swaps
//   GET  → list swap offers; filters: status, resource_id (workforce.employees.view)
//   POST → offer a shift swap (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/swaps' };

interface OfferSwapBody {
  shift_id?: unknown;
  offering_date?: unknown;
  notes?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const resourceId = url.searchParams.get('resource_id');

  const sql = db();

  const swaps = (await sql`
    SELECT
      s.id,
      s.offering_shift_id,
      s.offering_resource_id,
      o.name AS offering_resource_name,
      to_char(s.offering_date, 'YYYY-MM-DD') AS offering_date,
      s.claimed_by_resource_id,
      c.name AS claimed_by_resource_name,
      s.claimed_at,
      s.status,
      s.notes,
      s.handled_by,
      s.handled_at,
      s.created_at
    FROM public.shift_swaps s
    JOIN public.booking_resources o ON o.id = s.offering_resource_id
    LEFT JOIN public.booking_resources c ON c.id = s.claimed_by_resource_id
    WHERE s.client_id = ${a.ctx.clientId}::uuid
      AND (${status}::text IS NULL OR s.status = ${status}::text)
      AND (
        ${resourceId}::uuid IS NULL
        OR s.offering_resource_id = ${resourceId}::uuid
        OR s.claimed_by_resource_id = ${resourceId}::uuid
      )
    ORDER BY s.offering_date DESC, s.created_at DESC
  `) as unknown[];

  return jsonOk({ swaps });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  let body: OfferSwapBody;
  try {
    body = (await req.json()) as OfferSwapBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const shiftId = typeof body.shift_id === 'string' ? body.shift_id.trim() : '';
  if (!shiftId) return jsonError(400, 'shift_id_required');

  const offeringDate = typeof body.offering_date === 'string' ? body.offering_date.trim() : '';
  if (!offeringDate) return jsonError(400, 'offering_date_required');

  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

  const sql = db();

  // Verify shift belongs to client and get its resource_id.
  const shiftRows = (await sql`
    SELECT id, resource_id FROM public.workforce_shifts
    WHERE id = ${shiftId}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; resource_id: string }>;
  if (shiftRows.length === 0) return jsonError(404, 'shift_not_found');

  const offeringResourceId = shiftRows[0]!.resource_id;

  const rows = (await sql`
    INSERT INTO public.shift_swaps
      (client_id, offering_shift_id, offering_resource_id, offering_date, notes)
    VALUES
      (${a.ctx.clientId}::uuid, ${shiftId}::uuid, ${offeringResourceId}::uuid,
       ${offeringDate}::date, ${notes}::text)
    RETURNING
      id, offering_shift_id, offering_resource_id,
      to_char(offering_date, 'YYYY-MM-DD') AS offering_date,
      claimed_by_resource_id, claimed_at, status, notes,
      handled_by, handled_at, created_at
  `) as Array<Record<string, unknown>>;

  return jsonOk({ swap: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
