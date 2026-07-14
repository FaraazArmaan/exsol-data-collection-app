// GET /api/booking-public/:slug/resources — anonymous list of active resources (names only).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { usesWorkforceAvailability } from '../../src/modules/booking/lib/setup';
import { resolvePublicBooking } from './_booking-public';

export const config = { path: '/api/booking-public/:slug/resources', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/');
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const tenant = await resolvePublicBooking(slugFrom(req));
  if (!tenant) return jsonError(404, 'booking_unavailable');
  const sql = db();
  const setupRows = (await sql`
    SELECT booking_party_mode, availability_source
    FROM public.booking_setup
    WHERE bucket_id = ${tenant.clientId}::uuid
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
    WHERE br.bucket_id = ${tenant.clientId}::uuid
      AND br.active = true
      AND (NOT ${workforceAvailability}::boolean OR ep.employment_status = 'active')
    ORDER BY br.name
  `) as any[];
  return jsonOk({ resources });
}
