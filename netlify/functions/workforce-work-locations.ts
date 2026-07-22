// /api/workforce/work-locations — manager setup for attendance geofences.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { numberValue, readJsonObject } from './_workforce-self-time';
import { recordSensitiveAccess, requireSensitiveAccess } from './_workforce-privacy';

export const config = { path: '/api/workforce/work-locations' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'location_history');
  if (accessBasis instanceof Response) return accessBasis;

  const locations = await db()`
    SELECT
      wl.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', wa.id,
            'applies_to_all', wa.applies_to_all,
            'resource_id', wa.resource_id,
            'user_node_id', wa.user_node_id,
            'active', wa.active
          )
          ORDER BY wa.created_at
        ) FILTER (WHERE wa.id IS NOT NULL),
        '[]'::json
      ) AS assignments
    FROM public.workforce_work_locations wl
    LEFT JOIN public.workforce_work_location_assignments wa
      ON wa.work_location_id = wl.id
    WHERE wl.client_id = ${a.ctx.clientId}::uuid
    GROUP BY wl.id
    ORDER BY wl.active DESC, wl.name ASC
  ` as unknown[];
  await recordSensitiveAccess(a.ctx, 'location_history', '/api/workforce/work-locations', accessBasis);
  return jsonOk({ locations });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;
  const accessBasis = await requireSensitiveAccess(a.ctx, 'location_history');
  if (accessBasis instanceof Response) return accessBasis;

  const body = await readJsonObject(req);
  if (body instanceof Response) return body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const latitude = numberValue(body.latitude);
  const longitude = numberValue(body.longitude);
  const radiusMeters = numberValue(body.radius_meters) ?? 100;
  const minAccuracyMeters = numberValue(body.min_accuracy_meters) ?? 150;
  if (!name) return jsonError(400, 'name_required');
  if (latitude === null || latitude < -90 || latitude > 90) return jsonError(400, 'latitude_required');
  if (longitude === null || longitude < -180 || longitude > 180) return jsonError(400, 'longitude_required');
  if (radiusMeters <= 0 || radiusMeters > 5000) return jsonError(400, 'radius_invalid');
  if (minAccuracyMeters <= 0 || minAccuracyMeters > 5000) return jsonError(400, 'min_accuracy_invalid');

  const rows = await db()`
    INSERT INTO public.workforce_work_locations (
      client_id, name, latitude, longitude, radius_meters, min_accuracy_meters, created_by
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${name}::text,
      ${latitude}::numeric,
      ${longitude}::numeric,
      ${Math.round(radiusMeters)}::int,
      ${Math.round(minAccuracyMeters)}::int,
      ${a.ctx.userNodeId}::uuid
    )
    RETURNING *
  ` as Array<Record<string, unknown>>;
  const location = rows[0]!;

  const resourceId = typeof body.resource_id === 'string' && body.resource_id.trim() ? body.resource_id.trim() : null;
  const userNodeId = typeof body.user_node_id === 'string' && body.user_node_id.trim() ? body.user_node_id.trim() : null;
  const appliesToAll = resourceId || userNodeId ? false : body.applies_to_all !== false;
  await db()`
    INSERT INTO public.workforce_work_location_assignments (
      client_id, work_location_id, applies_to_all, resource_id, user_node_id
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${String(location.id)}::uuid,
      ${appliesToAll}::boolean,
      ${resourceId}::uuid,
      ${userNodeId}::uuid
    )
  `;
  await recordSensitiveAccess(a.ctx, 'location_history', '/api/workforce/work-locations', accessBasis, userNodeId);
  return jsonOk({ location }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
