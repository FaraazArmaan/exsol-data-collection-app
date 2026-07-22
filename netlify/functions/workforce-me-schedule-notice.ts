// /api/workforce/me/schedule-notice/:id — employee acknowledges a published schedule.
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { requireWorkforceSelf } from './_workforce-self-time';

export const config = { path: '/api/workforce/me/schedule-notice/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  const id = new URL(req.url).pathname.match(/workforce\/me\/schedule-notice\/([^/?]+)/)?.[1];
  if (!id || !UUID.test(id)) return jsonError(400, 'invalid_id');
  const a = await requireWorkforceSelf(req);
  if (!a.ok) return a.res;
  const rows = await db()`
    UPDATE public.workforce_schedule_notices notice
    SET acknowledged_at = COALESCE(acknowledged_at, now())
    FROM public.workforce_schedule_versions version
    WHERE notice.id = ${id}::uuid
      AND notice.client_id = ${a.ctx.clientId}::uuid
      AND notice.user_node_id = ${a.ctx.userNodeId}::uuid
      AND notice.schedule_version_id = version.id
      AND version.status = 'published'
      AND notice.acknowledgement_required = true
    RETURNING notice.id, notice.acknowledged_at
  ` as Array<Record<string, unknown>>;
  if (rows.length === 0) return jsonError(404, 'schedule_notice_not_found');
  return jsonOk({ notice: rows[0] });
}
