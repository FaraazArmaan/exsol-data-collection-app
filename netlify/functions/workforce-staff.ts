// /api/workforce/staff — GET
// Lists booking_resources with their linked user_nodes (name + role label).
// Used as the staff directory and to populate resource pickers on shift / project forms.
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/staff' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    const { jsonError } = await import('./_shared/http');
    return jsonError(405, 'method_not_allowed');
  }

  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const sql = db();
  // Each booking_resource is a named slot (room/staff); user_nodes are team members.
  // We join user_nodes via client_id and also pull the role label via client_roles.
  const resources = (await sql`
    SELECT
      br.id,
      br.name,
      br.active,
      COALESCE(
        json_agg(
          json_build_object(
            'id', un.id,
            'display_name', un.display_name,
            'role_label', cr.label
          )
          ORDER BY un.display_name
        ) FILTER (WHERE un.id IS NOT NULL),
        '[]'::json
      ) AS team_members
    FROM public.booking_resources br
    LEFT JOIN public.user_nodes un
      ON un.client_id = br.bucket_id
    LEFT JOIN public.client_roles cr
      ON cr.id = un.role_id
    WHERE br.bucket_id = ${a.ctx.clientId}::uuid
    GROUP BY br.id, br.name, br.active
    ORDER BY br.active DESC, br.name ASC
  `) as unknown[];
  return jsonOk({ resources });
}
