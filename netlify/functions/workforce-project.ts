// /api/workforce/project/:id
//   GET   → project detail + resource assignments (project-service.business.view)
//   PATCH { status } → advance FSM quoted→active→done (project-service.business.edit)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/project/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/workforce\/project\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

// Forward-only FSM. 'done' is terminal.
const FSM: Record<string, string> = { quoted: 'active', active: 'done' };

async function handleGet(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const rows = (await sql`
    SELECT p.id, p.name, p.status, p.customer_id, p.created_at, p.updated_at,
           c.display_name AS customer_name
    FROM public.projects p
    LEFT JOIN public.crm_customers c ON c.id = p.customer_id
    WHERE p.id = ${id}::uuid AND p.client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  if (!rows.length) return jsonError(404, 'project_not_found');

  const assignments = (await sql`
    SELECT pa.resource_id, br.name AS resource_name, pa.assigned_at
    FROM public.project_assignments pa
    JOIN public.booking_resources br ON br.id = pa.resource_id
    WHERE pa.project_id = ${id}::uuid
    ORDER BY br.name ASC
  `) as unknown[];

  return jsonOk({ project: rows[0], assignments });
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.edit']);
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const sql = db();
  const rows = (await sql`
    SELECT id, status FROM public.projects
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; status: string }>;
  if (!rows.length) return jsonError(404, 'project_not_found');

  const current = rows[0]!.status;
  const next = typeof body.status === 'string' ? body.status : FSM[current];
  const allowed = FSM[current];
  if (!allowed) return jsonError(409, 'project_already_done');
  if (next !== allowed) return jsonError(422, 'invalid_transition', { current, allowed });

  const updated = (await sql`
    UPDATE public.projects
    SET status = ${next}, updated_at = now()
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    RETURNING id, name, status, customer_id, created_at, updated_at
  `) as Array<Record<string, unknown>>;
  return jsonOk({ project: updated[0] });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'GET') return handleGet(req, id);
  if (req.method === 'PATCH') return handlePatch(req, id);
  return jsonError(405, 'method_not_allowed');
}
