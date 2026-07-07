// GET /api/hr/org — the client's user_nodes tree for the HR Org Chart.
// Gated on hr.employees.view (decoupled from _platform.users.*). Read-only over
// the canonical user_nodes tree with role + level labels + login status — HR
// keeps no duplicate person table.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireHr } from './_hr-authz';

export const config = { path: '/api/hr/org', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireHr(req, ['hr.employees.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const nodes = (await sql`
    SELECT un.id, un.parent_id, un.level_number, un.display_name,
           un.email::text AS email, un.phone, un.sort_order, un.created_at,
           cr.label AS role_label, cr.color AS role_color,
           cl.label AS level_label,
           EXISTS (SELECT 1 FROM public.user_node_credentials c WHERE c.user_node_id = un.id) AS has_login
    FROM public.user_nodes un
    LEFT JOIN public.client_roles cr ON cr.id = un.role_id
    LEFT JOIN public.client_levels cl ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    WHERE un.client_id = ${a.ctx.clientId}::uuid
    ORDER BY un.level_number NULLS LAST, un.sort_order, un.created_at
  `) as unknown[];
  return jsonOk({ nodes });
}
