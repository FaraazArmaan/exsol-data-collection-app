// /api/workforce/compliance
//   GET → compliance flags for a resource on a date (workforce.employees.view)
//   Query params: resource_id (required), date (YYYY-MM-DD, required)
//   Returns: { resource_id, date, total_hours, max_hours_exceeded, missing_break, entry_count }
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/compliance' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const resourceId = url.searchParams.get('resource_id');
  const date = url.searchParams.get('date');

  if (!resourceId || !UUID.test(resourceId)) return jsonError(400, 'resource_id_required');
  if (!date) return jsonError(400, 'date_required');

  const sql = db();

  // Verify resource belongs to this client.
  const resource = await sql`
    SELECT id FROM public.booking_resources
    WHERE id = ${resourceId}::uuid AND bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>;
  if (resource.length === 0) return jsonError(404, 'resource_not_found');

  // Fetch all timesheet entries for this resource on this date.
  // Time columns come back as "HH:MM:SS" from Postgres TIME type.
  const entries = await sql`
    SELECT
      start_time::text AS start_time,
      end_time::text   AS end_time
    FROM public.timesheet_entries
    WHERE client_id   = ${a.ctx.clientId}::uuid
      AND resource_id = ${resourceId}::uuid
      AND entry_date  = ${date}::date
    ORDER BY start_time
  ` as Array<{ start_time: string; end_time: string }>;

  if (entries.length === 0) {
    return jsonOk({ resource_id: resourceId, date, total_hours: 0, max_hours_exceeded: false, missing_break: false, entry_count: 0 });
  }

  function timeToMinutes(t: string): number {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }

  let totalMinutes = 0;
  for (const e of entries) {
    totalMinutes += timeToMinutes(e.end_time) - timeToMinutes(e.start_time);
  }
  const totalHours = parseFloat((totalMinutes / 60).toFixed(2));
  const maxHoursExceeded = totalHours > 10;

  // Missing break: if total > 6h and no adjacent gap >= 20 min.
  let missingBreak = false;
  if (totalHours > 6) {
    if (entries.length === 1) {
      missingBreak = true; // single block > 6h, no break possible
    } else {
      let hasBreak = false;
      for (let i = 0; i < entries.length - 1; i++) {
        const gapMinutes = timeToMinutes(entries[i + 1]!.start_time) - timeToMinutes(entries[i]!.end_time);
        if (gapMinutes >= 20) { hasBreak = true; break; }
      }
      missingBreak = !hasBreak;
    }
  }

  return jsonOk({ resource_id: resourceId, date, total_hours: totalHours, max_hours_exceeded: maxHoursExceeded, missing_break: missingBreak, entry_count: entries.length });
}
