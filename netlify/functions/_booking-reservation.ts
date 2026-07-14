// Shared server-only reservation checks. Every booking write must call this module.
import { db } from './_shared/db';
import {
  computeAvailability,
  type DaySchedule,
  type Interval,
  type Slot,
} from '../../src/modules/booking/lib/availability';
import { addMinutes, utcToZonedParts } from '../../src/modules/booking/lib/tz';
import { usesWorkforceAvailability } from '../../src/modules/booking/lib/setup';

export type ReservationService = {
  id: string;
  name: string;
  duration_min: number;
  buffer_min: number;
  price_cents: number;
  payment_mode: string;
  deposit_cents: number | null;
  eligible_resource_ids: string[];
};

type Availability = {
  service: ReservationService | null;
  slots: Slot[];
  resourceIds: string[];
  bookingCounts: Map<string, number>;
};

type ReservationFailure =
  | 'tenant_not_found'
  | 'service_not_found'
  | 'invalid_start'
  | 'resource_not_found'
  | 'slot_unavailable'
  | 'slot_taken';

export type ReservationResult =
  | { ok: true; service: ReservationService; resourceId: string; startIso: string; endIso: string }
  | { ok: false; code: ReservationFailure };

export interface ReservationRequest {
  clientId: string;
  serviceId: string;
  resourceId: string | 'any';
  start: string;
  excludeBookingId?: string;
  allowAvailabilityOverride?: boolean;
  allowOffGrid?: boolean;
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dateInZone(instant: Date, timeZone: string): string {
  const { y, m, d } = utcToZonedParts(instant, timeZone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

async function reservableSlots(input: {
  clientId: string;
  timeZone: string;
  serviceId: string;
  date: string;
  resourceId: string | 'any';
  excludeBookingId?: string;
  slotIntervalMin?: number;
}): Promise<Availability> {
  const sql = db();
  const settingsRows = (await sql`
    SELECT slot_interval_min, lead_time_min, weekly_schedule, date_overrides
    FROM public.booking_settings
    WHERE bucket_id = ${input.clientId}::uuid
    LIMIT 1
  `) as any[];
  const settings = settingsRows[0] ?? {
    slot_interval_min: 15,
    lead_time_min: 0,
    weekly_schedule: {},
    date_overrides: [],
  };
  const serviceRows = (await sql`
    SELECT id, name, duration_min, buffer_min, price_cents, payment_mode, deposit_cents,
           eligible_resource_ids
    FROM public.booking_services
    WHERE id = ${input.serviceId}::uuid
      AND bucket_id = ${input.clientId}::uuid
      AND active = true
    LIMIT 1
  `) as ReservationService[];
  const service = serviceRows[0] ?? null;
  if (!service) return { service: null, slots: [], resourceIds: [], bookingCounts: new Map() };
  const overrides: Array<{ date: string; closed?: boolean }> = settings.date_overrides ?? [];
  if (overrides.some((override) => override.date === input.date && override.closed)) {
    return { service, slots: [], resourceIds: [], bookingCounts: new Map() };
  }

  const setupRows = (await sql`
    SELECT booking_party_mode, availability_source
    FROM public.booking_setup
    WHERE bucket_id = ${input.clientId}::uuid AND completed_at IS NOT NULL
    LIMIT 1
  `) as Array<{
    booking_party_mode: 'specific_team_member' | 'any_team_member' | 'nobody_specific';
    availability_source: 'workforce' | 'manual';
  }>;
  const workforceAvailability = usesWorkforceAvailability(setupRows[0]);
  const requestedResource = input.resourceId === 'any' ? null : input.resourceId;
  const weekday = new Date(`${input.date}T12:00:00.000Z`).getUTCDay();
  const weekdayKey = WEEKDAYS[weekday]!;
  const eligible = service.eligible_resource_ids ?? [];
  const resourceRows = (await sql`
    SELECT br.id, br.weekly_schedule
    FROM public.booking_resources br
    LEFT JOIN public.workforce_employee_profiles ep
      ON ep.client_id = br.bucket_id AND ep.resource_id = br.id
    WHERE br.bucket_id = ${input.clientId}::uuid
      AND br.active = true
      AND (cardinality(${eligible}::uuid[]) = 0 OR br.id = ANY(${eligible}::uuid[]))
      AND (${input.resourceId === 'any'}::boolean OR br.id = ${requestedResource}::uuid)
      AND (NOT ${workforceAvailability}::boolean OR ep.employment_status = 'active')
  `) as Array<{ id: string; weekly_schedule: DaySchedule }>;
  const resourceIds = resourceRows.map((row) => row.id);
  if (resourceIds.length === 0)
    return { service, slots: [], resourceIds, bookingCounts: new Map() };

  const busyRows = (await sql`
    SELECT r.resource_id, lower(r.time_range) AS s, upper(r.time_range) AS e
    FROM public.booking_line_reservations r
    JOIN public.booking_visits v ON v.id = r.visit_id
    LEFT JOIN public.bookings b ON b.visit_id = r.visit_id
    WHERE v.bucket_id = ${input.clientId}::uuid
      AND r.resource_id = ANY(${resourceIds}::uuid[])
      AND r.status IN ('pending', 'confirmed', 'blocked')
      AND (${input.excludeBookingId ?? null}::uuid IS NULL OR b.id <> ${input.excludeBookingId ?? null}::uuid)
      AND r.time_range && tstzrange((${input.date}::date - 1)::timestamptz, (${input.date}::date + 2)::timestamptz)
    UNION ALL
    SELECT b.resource_id, lower(b.time_range) AS s,
           upper(b.time_range) + make_interval(mins => COALESCE(s.buffer_min, 0)) AS e
    FROM public.bookings b
    LEFT JOIN public.booking_services s ON s.id = b.service_id
    WHERE b.bucket_id = ${input.clientId}::uuid
      AND b.resource_id = ANY(${resourceIds}::uuid[])
      AND b.status IN ('pending', 'confirmed', 'blocked')
      AND b.appointment_line_id IS NULL
      AND (${input.excludeBookingId ?? null}::uuid IS NULL OR b.id <> ${input.excludeBookingId ?? null}::uuid)
      AND tstzrange(lower(b.time_range), upper(b.time_range) + make_interval(mins => COALESCE(s.buffer_min, 0)))
          && tstzrange((${input.date}::date - 1)::timestamptz, (${input.date}::date + 2)::timestamptz)
  `) as Array<{ resource_id: string; s: string; e: string }>;
  const timeOffRows = (await sql`
    SELECT resource_id, starts_at AS s, ends_at AS e
    FROM public.booking_resource_time_off
    WHERE resource_id = ANY(${resourceIds}::uuid[])
      AND tstzrange(starts_at, ends_at) && tstzrange((${input.date}::date - 1)::timestamptz, (${input.date}::date + 2)::timestamptz)
  `) as Array<{ resource_id: string; s: string; e: string }>;
  const shiftRows = workforceAvailability
    ? ((await sql`
        SELECT resource_id, start_time::text AS start_time, end_time::text AS end_time
        FROM public.workforce_shifts
        WHERE client_id = ${input.clientId}::uuid
          AND resource_id = ANY(${resourceIds}::uuid[])
          AND weekday = ${weekday}
      `) as Array<{ resource_id: string; start_time: string; end_time: string }>)
    : [];
  const leaveRows = workforceAvailability
    ? ((await sql`
        SELECT resource_id
        FROM public.leave_requests
        WHERE client_id = ${input.clientId}::uuid
          AND resource_id = ANY(${resourceIds}::uuid[])
          AND status = 'approved'
          AND start_date <= ${input.date}::date
          AND end_date >= ${input.date}::date
      `) as Array<{ resource_id: string }>)
    : [];

  const busyByResource = new Map<string, Interval[]>();
  const bookingCounts = new Map<string, number>();
  for (const resourceId of resourceIds) busyByResource.set(resourceId, []);
  for (const row of busyRows) {
    busyByResource.get(row.resource_id)?.push({ start: new Date(row.s), end: new Date(row.e) });
    bookingCounts.set(row.resource_id, (bookingCounts.get(row.resource_id) ?? 0) + 1);
  }
  for (const row of timeOffRows) {
    busyByResource.get(row.resource_id)?.push({ start: new Date(row.s), end: new Date(row.e) });
  }
  const shiftsByResource = new Map<string, Array<{ open: string; close: string }>>();
  for (const shift of shiftRows) {
    const shifts = shiftsByResource.get(shift.resource_id) ?? [];
    shifts.push({ open: shift.start_time.slice(0, 5), close: shift.end_time.slice(0, 5) });
    shiftsByResource.set(shift.resource_id, shifts);
  }
  const onLeave = new Set(leaveRows.map((leave) => leave.resource_id));
  const slots = computeAvailability({
    date: input.date,
    timeZone: input.timeZone,
    slotIntervalMin: input.slotIntervalMin ?? settings.slot_interval_min,
    leadTimeMin: settings.lead_time_min,
    now: new Date(),
    tenantWeekly: (settings.weekly_schedule ?? {}) as DaySchedule,
    service: { durationMin: service.duration_min, bufferMin: service.buffer_min },
    resources: resourceRows
      .filter((resource) => !onLeave.has(resource.id))
      .map((resource) => ({
        id: resource.id,
        weekly: workforceAvailability
          ? ({ [weekdayKey]: shiftsByResource.get(resource.id) ?? [] } as DaySchedule)
          : Object.keys(resource.weekly_schedule ?? {}).length
            ? resource.weekly_schedule
            : null,
        busy: busyByResource.get(resource.id) ?? [],
      })),
  });
  return { service, slots, resourceIds, bookingCounts };
}

async function hasLiveConflict(input: {
  clientId: string;
  resourceIds: string[];
  startIso: string;
  endIso: string;
  excludeBookingId?: string;
}): Promise<boolean> {
  if (input.resourceIds.length === 0) return false;
  const rows = (await db()`
    SELECT 1
    FROM public.booking_line_reservations r
    JOIN public.booking_visits v ON v.id = r.visit_id
    LEFT JOIN public.bookings b ON b.visit_id = r.visit_id
    WHERE v.bucket_id = ${input.clientId}::uuid
      AND r.resource_id = ANY(${input.resourceIds}::uuid[])
      AND r.status IN ('pending', 'confirmed', 'blocked')
      AND (${input.excludeBookingId ?? null}::uuid IS NULL OR b.id <> ${input.excludeBookingId ?? null}::uuid)
      AND r.time_range && tstzrange(${input.startIso}::timestamptz, ${input.endIso}::timestamptz)
    UNION ALL
    SELECT 1
    FROM public.bookings b
    LEFT JOIN public.booking_services s ON s.id = b.service_id
    WHERE b.bucket_id = ${input.clientId}::uuid
      AND b.resource_id = ANY(${input.resourceIds}::uuid[])
      AND b.status IN ('pending', 'confirmed', 'blocked')
      AND b.appointment_line_id IS NULL
      AND (${input.excludeBookingId ?? null}::uuid IS NULL OR b.id <> ${input.excludeBookingId ?? null}::uuid)
      AND tstzrange(lower(b.time_range), upper(b.time_range) + make_interval(mins => COALESCE(s.buffer_min, 0)))
          && tstzrange(${input.startIso}::timestamptz, ${input.endIso}::timestamptz)
    LIMIT 1
  `) as Array<{ '?column?': number }>;
  return rows.length > 0;
}

export async function validateReservation(input: ReservationRequest): Promise<ReservationResult> {
  if (input.resourceId !== 'any' && !UUID.test(input.resourceId)) {
    return { ok: false, code: 'resource_not_found' };
  }
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) return { ok: false, code: 'invalid_start' };
  const clientRows = (await db()`
    SELECT timezone FROM public.clients WHERE id = ${input.clientId}::uuid LIMIT 1
  `) as Array<{ timezone: string }>;
  if (!clientRows[0]) return { ok: false, code: 'tenant_not_found' };
  const date = dateInZone(start, clientRows[0].timezone);
  const availability = await reservableSlots({
    clientId: input.clientId,
    timeZone: clientRows[0].timezone,
    serviceId: input.serviceId,
    date,
    resourceId: input.resourceId,
    excludeBookingId: input.excludeBookingId,
    slotIntervalMin: input.allowOffGrid ? 1 : undefined,
  });
  if (!availability.service) return { ok: false, code: 'service_not_found' };
  if (availability.resourceIds.length === 0) return { ok: false, code: 'resource_not_found' };

  const startIso = start.toISOString();
  const endIso = addMinutes(start, availability.service.duration_min).toISOString();
  const footprintEndIso = addMinutes(
    start,
    availability.service.duration_min + availability.service.buffer_min,
  ).toISOString();
  if (input.allowAvailabilityOverride) {
    if (
      await hasLiveConflict({
        clientId: input.clientId,
        resourceIds: availability.resourceIds,
        startIso,
        endIso: footprintEndIso,
        excludeBookingId: input.excludeBookingId,
      })
    )
      return { ok: false, code: 'slot_taken' };
    return {
      ok: true,
      service: availability.service,
      resourceId: input.resourceId === 'any' ? availability.resourceIds[0]! : input.resourceId,
      startIso,
      endIso,
    };
  }

  const match = availability.slots.find(
    (slot) =>
      slot.startUtc.toISOString() === startIso &&
      (input.resourceId === 'any' || slot.resourceId === input.resourceId),
  );
  if (!match) {
    const conflict = await hasLiveConflict({
      clientId: input.clientId,
      resourceIds: availability.resourceIds,
      startIso,
      endIso: footprintEndIso,
      excludeBookingId: input.excludeBookingId,
    });
    return { ok: false, code: conflict ? 'slot_taken' : 'slot_unavailable' };
  }
  return {
    ok: true,
    service: availability.service,
    resourceId: match.resourceId,
    startIso,
    endIso,
  };
}

export async function getPublicAvailability(input: {
  clientId: string;
  timeZone: string;
  serviceId: string;
  date: string;
  resourceId: string | 'any';
}): Promise<Availability> {
  return reservableSlots(input);
}
