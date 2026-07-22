import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { requireWorkforce, type WorkforceAuthCtx } from './_workforce-authz';

export interface SelfEmployee {
  resource_id: string;
  user_node_id: string;
  legal_name: string;
  resource_name: string;
}

export interface WorkLocation {
  id: string;
  name: string;
  latitude: string | number;
  longitude: string | number;
  radius_meters: number;
  min_accuracy_meters: number;
}

export interface GeoInput {
  latitude: number;
  longitude: number;
  accuracy_meters: number;
}

export interface GeoDecision {
  ok: boolean;
  code?: string;
  location: WorkLocation | null;
  distance_meters: number | null;
  result: 'passed' | 'failed' | 'accuracy_rejected' | 'unconfigured';
}

export async function requireWorkforceSelf(req: Request) {
  const a = await requireWorkforce(req, []);
  if (!a.ok) return a;
  return a;
}

export async function resolveSelfEmployee(ctx: WorkforceAuthCtx): Promise<SelfEmployee | Response> {
  const rows = await db()`
    SELECT
      p.resource_id,
      p.user_node_id,
      p.legal_name,
      br.name AS resource_name
    FROM public.workforce_employee_profiles p
    JOIN public.booking_resources br ON br.id = p.resource_id
    WHERE p.client_id = ${ctx.clientId}::uuid
      AND p.user_node_id = ${ctx.userNodeId}::uuid
      AND p.employment_status = 'active'
      AND br.active = true
    ORDER BY p.updated_at DESC
    LIMIT 1
  ` as SelfEmployee[];
  if (rows.length === 0) return jsonError(404, 'employee_profile_not_linked');
  return rows[0]!;
}

export async function listAssignedWorkLocations(ctx: WorkforceAuthCtx, employee: SelfEmployee): Promise<WorkLocation[]> {
  return await db()`
    SELECT DISTINCT
      wl.id,
      wl.name,
      wl.latitude,
      wl.longitude,
      wl.radius_meters,
      wl.min_accuracy_meters
    FROM public.workforce_work_locations wl
    JOIN public.workforce_work_location_assignments wa
      ON wa.work_location_id = wl.id
    WHERE wl.client_id = ${ctx.clientId}::uuid
      AND wa.client_id = ${ctx.clientId}::uuid
      AND wl.active = true
      AND wa.active = true
      AND (
        wa.applies_to_all = true
        OR wa.resource_id = ${employee.resource_id}::uuid
        OR wa.user_node_id = ${ctx.userNodeId}::uuid
      )
    ORDER BY wl.name ASC
  ` as WorkLocation[];
}

export function geoFromBody(body: Record<string, unknown>): GeoInput | Response {
  const latitude = numberValue(body.latitude);
  const longitude = numberValue(body.longitude);
  const accuracy = numberValue(body.accuracy_meters);
  if (latitude === null || latitude < -90 || latitude > 90) return jsonError(400, 'latitude_required');
  if (longitude === null || longitude < -180 || longitude > 180) return jsonError(400, 'longitude_required');
  if (accuracy === null || accuracy <= 0) return jsonError(400, 'accuracy_required');
  return { latitude, longitude, accuracy_meters: accuracy };
}

export function idempotencyKeyFromBody(body: Record<string, unknown>): string | null | Response {
  if (body.idempotency_key === undefined || body.idempotency_key === null || body.idempotency_key === '') return null;
  if (typeof body.idempotency_key !== 'string') return jsonError(400, 'idempotency_key_invalid');
  const key = body.idempotency_key.trim();
  if (key.length < 8 || key.length > 128) return jsonError(400, 'idempotency_key_invalid');
  return key;
}

export function validateGeofence(geo: GeoInput, locations: WorkLocation[]): GeoDecision {
  if (locations.length === 0) {
    return { ok: false, code: 'geofence_unconfigured', location: null, distance_meters: null, result: 'unconfigured' };
  }

  let nearest: { location: WorkLocation; distance: number } | null = null;
  for (const location of locations) {
    const distance = haversineMeters(
      geo.latitude,
      geo.longitude,
      Number(location.latitude),
      Number(location.longitude),
    );
    if (!nearest || distance < nearest.distance) nearest = { location, distance };
    if (distance <= location.radius_meters && geo.accuracy_meters <= location.min_accuracy_meters) {
      return { ok: true, location, distance_meters: Math.round(distance * 100) / 100, result: 'passed' };
    }
  }

  if (nearest && geo.accuracy_meters > nearest.location.min_accuracy_meters) {
    return {
      ok: false,
      code: 'location_accuracy_too_low',
      location: nearest.location,
      distance_meters: Math.round(nearest.distance * 100) / 100,
      result: 'accuracy_rejected',
    };
  }
  return {
    ok: false,
    code: 'outside_geofence',
    location: nearest?.location ?? null,
    distance_meters: nearest ? Math.round(nearest.distance * 100) / 100 : null,
    result: 'failed',
  };
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError(400, 'invalid_json');
    return body as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }
}

export async function openPunch(ctx: WorkforceAuthCtx, employee: SelfEmployee) {
  const rows = await db()`
    SELECT *
    FROM public.workforce_punches
    WHERE client_id = ${ctx.clientId}::uuid
      AND resource_id = ${employee.resource_id}::uuid
      AND punched_out_at IS NULL
    ORDER BY punched_in_at DESC
    LIMIT 1
  ` as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

export async function openBreak(ctx: WorkforceAuthCtx, punchId: string) {
  const rows = await db()`
    SELECT *
    FROM public.workforce_punch_breaks
    WHERE client_id = ${ctx.clientId}::uuid
      AND punch_id = ${punchId}::uuid
      AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  ` as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

export async function appendClockEvent(args: {
  ctx: WorkforceAuthCtx;
  employee: SelfEmployee;
  eventType: 'clock_in' | 'clock_out' | 'break_start' | 'break_end' | 'correction' | 'note';
  punchId?: string | null;
  notes?: string | null;
  geo?: GeoInput | null;
  decision?: GeoDecision | null;
  idempotencyKey?: string | null;
}) {
  const location = args.decision?.location ?? null;
  const result = args.decision?.result ?? (args.geo ? 'failed' : 'not_required');
  await db()`
    INSERT INTO public.workforce_time_clock_events (
      client_id, resource_id, user_node_id, punch_id, event_type, source, notes, recorded_by,
      work_location_id, latitude, longitude, accuracy_meters, distance_meters, geofence_result, idempotency_key
    )
    VALUES (
      ${args.ctx.clientId}::uuid,
      ${args.employee.resource_id}::uuid,
      ${args.ctx.userNodeId}::uuid,
      ${args.punchId ?? null}::uuid,
      ${args.eventType}::text,
      'self_service',
      ${args.notes ?? null}::text,
      ${args.ctx.userNodeId}::uuid,
      ${location?.id ?? null}::uuid,
      ${args.geo?.latitude ?? null}::numeric,
      ${args.geo?.longitude ?? null}::numeric,
      ${args.geo?.accuracy_meters ?? null}::numeric,
      ${args.decision?.distance_meters ?? null}::numeric,
      ${result}::text,
      ${args.idempotencyKey ?? null}::text
    )
    ON CONFLICT DO NOTHING
  `;
}

export function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const radius = 6371000;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const dPhi = toRadians(lat2 - lat1);
  const dLambda = toRadians(lon2 - lon1);
  const a = Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}
