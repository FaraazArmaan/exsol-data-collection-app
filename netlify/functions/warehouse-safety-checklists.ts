// /api/warehouse/safety-checklists
//   GET  → recurring checklists with last-signed + derived due status (business.view)
//   POST → create a checklist (business.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/safety-checklists' };

const CADENCES = new Set(['daily', 'weekly', 'monthly']);
const CADENCE_MS: Record<string, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
};

interface CreateBody { title?: unknown; cadence?: unknown }

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.business.view']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    SELECT c.id, c.title, c.cadence, c.active, c.created_at,
           (SELECT max(s.signed_at) FROM public.safety_checklist_signoffs s WHERE s.checklist_id = c.id) AS last_signed_at
    FROM public.safety_checklists c
    WHERE c.client_id = ${a.ctx.clientId}::uuid
    ORDER BY c.created_at ASC
  `) as Array<{ id: string; title: string; cadence: string; active: boolean; created_at: string; last_signed_at: string | null }>;

  const now = Date.now();
  const checklists = rows.map((c) => {
    const window = CADENCE_MS[c.cadence] ?? CADENCE_MS.weekly!;
    const due = c.last_signed_at === null || (now - new Date(c.last_signed_at).getTime()) > window;
    return { ...c, due };
  });
  return jsonOk({ checklists });
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
  const cadence = typeof body.cadence === 'string' ? body.cadence.trim() : 'weekly';
  if (!title) return jsonError(400, 'title_required');
  if (!CADENCES.has(cadence)) return jsonError(400, 'cadence_invalid');

  const sql = db();
  const rows = (await sql`
    INSERT INTO public.safety_checklists (client_id, title, cadence)
    VALUES (${a.ctx.clientId}::uuid, ${title}, ${cadence})
    RETURNING id, title, cadence, active, created_at
  `) as Array<Record<string, unknown>>;
  return jsonOk({ checklist: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
