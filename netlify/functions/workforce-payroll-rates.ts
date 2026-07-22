// /api/workforce/payroll-rates
//   GET  → list payroll rates (workforce.payroll.view)
//   POST → set (upsert) a rate (workforce.payroll.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { recordSensitiveAccess, requireSensitiveAccess } from './_workforce-privacy';

export const config = { path: '/api/workforce/payroll-rates' };

interface SetRateBody {
  user_node_id?: unknown;
  hourly_rate?: unknown;
  effective_from?: unknown;
  notes?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.view']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;

  const url = new URL(req.url);
  const userNodeId = url.searchParams.get('user_node_id');

  const sql = db();

  const rates = (await sql`
    SELECT
      pr.id,
      pr.user_node_id,
      pr.hourly_rate,
      to_char(pr.effective_from, 'YYYY-MM-DD') AS effective_from,
      pr.notes,
      pr.created_at
    FROM public.payroll_rates pr
    WHERE pr.client_id = ${a.ctx.clientId}::uuid
      AND (${userNodeId}::uuid IS NULL OR pr.user_node_id = ${userNodeId}::uuid)
    ORDER BY pr.effective_from DESC, pr.created_at DESC
  `) as unknown[];
  await recordSensitiveAccess(a.ctx, 'compensation', '/api/workforce/payroll-rates', accessBasis);
  return jsonOk({ rates });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.payroll.create']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'compensation');
  if (accessBasis instanceof Response) return accessBasis;

  let body: SetRateBody;
  try {
    body = (await req.json()) as SetRateBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const userNodeId = typeof body.user_node_id === 'string' ? body.user_node_id.trim() : '';
  if (!userNodeId) return jsonError(400, 'user_node_id_required');

  const hourlyRateRaw = body.hourly_rate;
  const hourlyRate = typeof hourlyRateRaw === 'number'
    ? hourlyRateRaw
    : typeof hourlyRateRaw === 'string'
      ? parseFloat(hourlyRateRaw)
      : NaN;
  if (isNaN(hourlyRate) || hourlyRate < 0) return jsonError(400, 'hourly_rate_invalid');

  const effectiveFrom = typeof body.effective_from === 'string' ? body.effective_from.trim() : '';
  if (!effectiveFrom) return jsonError(400, 'effective_from_required');

  const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null;

  const sql = db();

  const rows = (await sql`
    INSERT INTO public.payroll_rates
      (client_id, user_node_id, hourly_rate, effective_from, notes)
    VALUES
      (${a.ctx.clientId}::uuid, ${userNodeId}::uuid, ${hourlyRate}::numeric, ${effectiveFrom}::date, ${notes}::text)
    ON CONFLICT (client_id, user_node_id, effective_from) DO UPDATE
      SET hourly_rate = EXCLUDED.hourly_rate,
          notes       = EXCLUDED.notes
    RETURNING
      id,
      user_node_id,
      hourly_rate,
      to_char(effective_from, 'YYYY-MM-DD') AS effective_from,
      notes,
      created_at
  `) as Array<Record<string, unknown>>;
  await recordSensitiveAccess(a.ctx, 'compensation', '/api/workforce/payroll-rates', accessBasis, userNodeId);
  return jsonOk({ rate: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
