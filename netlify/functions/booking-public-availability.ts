// GET /api/booking-public/:slug/availability?service_id=&date=&resource_id=any|<id>
// Anonymous. Loads DB rows, subtracts date-overrides + time-off + bookings into busy
// intervals, then runs the pure computeAvailability. "any" collapses to one slot/start
// via least-busy assignment.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { computeAvailability, type DaySchedule, type Interval } from '../../src/modules/booking/lib/availability';
import { pickLeastBusy } from '../../src/modules/booking/lib/autoassign';

export const config = { path: '/api/booking-public/:slug/availability', method: 'GET' };

function slugFrom(req: Request): string {
  const p = new URL(req.url).pathname.split('/');
  return p[p.length - 2] ?? '';
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const url = new URL(req.url);
  const serviceId = url.searchParams.get('service_id') ?? '';
  const date = url.searchParams.get('date') ?? '';
  const wantResource = url.searchParams.get('resource_id') ?? 'any';
  if (!/^[0-9a-f-]{36}$/i.test(serviceId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonError(400, 'invalid_query');
  }

  const sql = db();
  const c = (await sql`SELECT id, timezone FROM public.clients WHERE slug = ${slugFrom(req)} LIMIT 1`) as Array<{ id: string; timezone: string }>;
  if (!c[0]) return jsonError(404, 'tenant_not_found');
  const clientId = c[0].id, timeZone = c[0].timezone;

  const st = (await sql`SELECT slot_interval_min, lead_time_min, weekly_schedule, date_overrides
    FROM public.booking_settings WHERE bucket_id = ${clientId}::uuid LIMIT 1`) as any[];
  const settings = st[0] ?? { slot_interval_min: 15, lead_time_min: 0, weekly_schedule: {}, date_overrides: [] };

  const overrides: Array<{ date: string; closed?: boolean }> = settings.date_overrides ?? [];
  if (overrides.some((o) => o.date === date && o.closed)) return jsonOk({ slots: [] });

  const svc = (await sql`SELECT duration_min, buffer_min, eligible_resource_ids
    FROM public.booking_services WHERE id = ${serviceId}::uuid AND bucket_id = ${clientId}::uuid AND active = true LIMIT 1`) as any[];
  if (!svc[0]) return jsonError(404, 'service_not_found');

  const eligible: string[] = svc[0].eligible_resource_ids ?? [];
  const isAny = wantResource === 'any';
  const named = isAny ? null : wantResource;
  // Single query, no nested fragments: the boolean short-circuits the id filter for "any".
  const resourceRows = (await sql`
    SELECT id, weekly_schedule FROM public.booking_resources
    WHERE bucket_id = ${clientId}::uuid AND active = true
      AND (cardinality(${eligible}::uuid[]) = 0 OR id = ANY(${eligible}::uuid[]))
      AND (${isAny}::boolean OR id = ${named}::uuid)
  `) as Array<{ id: string; weekly_schedule: DaySchedule }>;
  if (resourceRows.length === 0) return jsonOk({ slots: [] });

  const resIds = resourceRows.map((r) => r.id);
  const busyRows = (await sql`
    SELECT resource_id, lower(time_range) AS s, upper(time_range) AS e FROM public.bookings
    WHERE bucket_id = ${clientId}::uuid AND resource_id = ANY(${resIds}::uuid[])
      AND status IN ('pending','confirmed','blocked')
      AND time_range && tstzrange((${date}::date - 1)::timestamptz, (${date}::date + 2)::timestamptz)
  `) as Array<{ resource_id: string; s: string; e: string }>;
  const timeOffRows = (await sql`
    SELECT resource_id, starts_at AS s, ends_at AS e FROM public.booking_resource_time_off
    WHERE resource_id = ANY(${resIds}::uuid[])
      AND tstzrange(starts_at, ends_at) && tstzrange((${date}::date - 1)::timestamptz, (${date}::date + 2)::timestamptz)
  `) as Array<{ resource_id: string; s: string; e: string }>;

  const busyByResource = new Map<string, Interval[]>();
  for (const id of resIds) busyByResource.set(id, []);
  for (const r of [...busyRows, ...timeOffRows]) {
    busyByResource.get(r.resource_id)?.push({ start: new Date(r.s), end: new Date(r.e) });
  }

  const slots = computeAvailability({
    date, timeZone, slotIntervalMin: settings.slot_interval_min, leadTimeMin: settings.lead_time_min,
    now: new Date(),
    tenantWeekly: (settings.weekly_schedule ?? {}) as DaySchedule,
    service: { durationMin: svc[0].duration_min, bufferMin: svc[0].buffer_min },
    resources: resourceRows.map((r) => ({
      id: r.id,
      weekly: r.weekly_schedule && Object.keys(r.weekly_schedule).length ? r.weekly_schedule : null,
      busy: busyByResource.get(r.id) ?? [],
    })),
  });

  if (!isAny) {
    return jsonOk({ slots: slots.map((s) => ({ start: s.startUtc.toISOString(), end: s.endUtc.toISOString(), resource_id: s.resourceId })) });
  }
  // "any": one slot per start, assigned to the least-busy free resource.
  const counts = new Map<string, number>();
  for (const b of busyRows) counts.set(b.resource_id, (counts.get(b.resource_id) ?? 0) + 1);
  const byStart = new Map<string, string[]>();
  for (const s of slots) {
    const k = s.startUtc.toISOString();
    const arr = byStart.get(k); if (arr) arr.push(s.resourceId); else byStart.set(k, [s.resourceId]);
  }
  const out = [...byStart.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([start, ids]) => {
    const pick = pickLeastBusy(ids.map((id) => ({ id, bookingsToday: counts.get(id) ?? 0 })))!;
    const end = slots.find((s) => s.startUtc.toISOString() === start && s.resourceId === pick)!.endUtc.toISOString();
    return { start, end, resource_id: pick };
  });
  return jsonOk({ slots: out });
}
