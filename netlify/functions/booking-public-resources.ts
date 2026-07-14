// GET /api/booking-public/:slug/resources — anonymous list of active resources (names only).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { usesWorkforceAvailability } from '../../src/modules/booking/lib/setup';

export const config = { path: '/api/booking-public/:slug/resources', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/');
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const sql = db();
  const c =
    (await sql`SELECT id FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{
      id: string;
    }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const setupRows = (await sql`
    SELECT booking_party_mode, availability_source
    FROM public.booking_setup
    WHERE bucket_id = ${c[0].id}::uuid AND completed_at IS NOT NULL
    LIMIT 1
  `) as Array<{
    booking_party_mode: 'specific_team_member' | 'any_team_member' | 'nobody_specific';
    availability_source: 'workforce' | 'manual';
  }>;
  const workforceAvailability = usesWorkforceAvailability(setupRows[0]);
  const resources = (await sql`
    SELECT br.id, br.name
    FROM public.booking_resources br
    LEFT JOIN public.workforce_employee_profiles ep
      ON ep.client_id = br.bucket_id AND ep.resource_id = br.id
    WHERE br.bucket_id = ${c[0].id}::uuid
      AND br.active = true
      AND (NOT ${workforceAvailability}::boolean OR ep.employment_status = 'active')
    ORDER BY br.name
  `) as any[];
  return jsonOk({ resources });
}
