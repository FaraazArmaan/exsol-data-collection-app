// /api/workforce/time-ledger
//   GET  → list clock events and corrections (workforce.employees.view)
//   POST → append an event or request a correction (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';
import { jsonBodyField, nullableStringField, optionalUuidField, optionalUuidParam, readJson, resourceExists, stringField } from './_workforce-depth-utils';

export const config = { path: '/api/workforce/time-ledger' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const resourceId = optionalUuidParam(new URL(req.url).searchParams.get('resource_id'), 'resource_id');
  if (resourceId instanceof Response) return resourceId;
  const events = await db()`
    SELECT *
    FROM public.workforce_time_clock_events
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND (${resourceId}::uuid IS NULL OR resource_id = ${resourceId}::uuid)
    ORDER BY occurred_at DESC, created_at DESC
    LIMIT 200
  ` as unknown[];
  const corrections = await db()`
    SELECT *
    FROM public.workforce_time_corrections
    WHERE client_id = ${a.ctx.clientId}::uuid
      AND (${resourceId}::uuid IS NULL OR resource_id = ${resourceId}::uuid)
    ORDER BY created_at DESC
    LIMIT 200
  ` as unknown[];
  return jsonOk({ events, corrections });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  const body = await readJson(req);
  if (body instanceof Response) return body;
  const kind = stringField(body, 'kind') || 'event';
  const resourceId = stringField(body, 'resource_id');
  if (!resourceId) return jsonError(400, 'resource_id_required');
  if (!(await resourceExists(a.ctx.clientId, resourceId))) return jsonError(404, 'resource_not_found');

  if (kind === 'correction') {
    const correctionType = stringField(body, 'correction_type');
    if (!correctionType) return jsonError(400, 'correction_type_required');
    const punchId = optionalUuidField(body, 'punch_id');
    if (punchId instanceof Response) return punchId;
    const rows = await db()`
      INSERT INTO public.workforce_time_corrections (
        client_id, punch_id, resource_id, requested_by, correction_type, original_values, new_values, notes
      )
      VALUES (
        ${a.ctx.clientId}::uuid,
        ${punchId}::uuid,
        ${resourceId}::uuid,
        ${a.ctx.userNodeId}::uuid,
        ${correctionType}::text,
        ${jsonBodyField(body, 'original_values')}::jsonb,
        ${jsonBodyField(body, 'new_values')}::jsonb,
        ${nullableStringField(body, 'notes')}::text
      )
      RETURNING *
    ` as Array<Record<string, unknown>>;
    return jsonOk({ correction: rows[0] }, { status: 201 });
  }

  const eventType = stringField(body, 'event_type');
  if (!eventType) return jsonError(400, 'event_type_required');
  const userNodeId = optionalUuidField(body, 'user_node_id');
  if (userNodeId instanceof Response) return userNodeId;
  const punchId = optionalUuidField(body, 'punch_id');
  if (punchId instanceof Response) return punchId;
  const rows = await db()`
    INSERT INTO public.workforce_time_clock_events (
      client_id, resource_id, user_node_id, punch_id, event_type, occurred_at, source, notes, metadata, recorded_by
    )
    VALUES (
      ${a.ctx.clientId}::uuid,
      ${resourceId}::uuid,
      ${userNodeId}::uuid,
      ${punchId}::uuid,
      ${eventType}::text,
      COALESCE(NULLIF(${stringField(body, 'occurred_at')}::text, '')::timestamptz, now()),
      COALESCE(NULLIF(${stringField(body, 'source')}::text, ''), 'manual'),
      ${nullableStringField(body, 'notes')}::text,
      ${jsonBodyField(body, 'metadata')}::jsonb,
      ${a.ctx.userNodeId}::uuid
    )
    RETURNING *
  ` as Array<Record<string, unknown>>;
  return jsonOk({ event: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
