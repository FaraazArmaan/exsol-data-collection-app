// /api/workforce/staff — GET
// Lists operational booking_resources with their linked employee Team user.
// Used to populate resource pickers on shift / project forms.
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
  // Each booking_resource is a named operational slot. Team users are linked
  // only through workforce_employee_profiles, not by sharing a client_id.
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
            'email', COALESCE(unc.email, un.email),
            'level_number', un.level_number,
            'level_label', cl.label,
            'role_label', cr.label,
            'has_login', unc.id IS NOT NULL,
            'login_disabled', unc.disabled_at IS NOT NULL
          )
          ORDER BY un.display_name
        ) FILTER (WHERE un.id IS NOT NULL),
        '[]'::json
      ) AS team_members
    FROM public.booking_resources br
    LEFT JOIN public.workforce_employee_profiles p
      ON p.client_id = br.bucket_id AND p.resource_id = br.id
    LEFT JOIN public.user_nodes un
      ON un.client_id = br.bucket_id AND un.id = p.user_node_id
    LEFT JOIN public.client_roles cr
      ON cr.id = un.role_id
    LEFT JOIN public.client_levels cl
      ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    LEFT JOIN public.user_node_credentials unc
      ON unc.user_node_id = un.id
    WHERE br.bucket_id = ${a.ctx.clientId}::uuid
    GROUP BY br.id, br.name, br.active
    ORDER BY br.active DESC, br.name ASC
  `) as unknown[];
  return jsonOk({ resources });
}
