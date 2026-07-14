// GET/PUT /api/booking/publication — client-controlled public Booking publication state.
import { z } from 'zod';
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';
import { requireBooking } from './_booking-authz';
import { publicBookingUrl } from './_public-site-url';

export const config = { path: '/api/booking/publication', method: ['GET', 'PUT'] };

const PublicationPut = z.object({ enabled: z.boolean() });

function publicUrl(slug: string) {
  return publicBookingUrl(slug, process.env.PUBLIC_BASE_URL);
}

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  if (req.method !== 'GET' && req.method !== 'PUT')
    return new Response('Method Not Allowed', { status: 405 });
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  const a = await requireBooking(req, [read ? 'booking.employees.view' : 'booking.employees.edit']);
  if (!a.ok) return a.res;
  const sql = db();
  const rows = (await sql`
    SELECT bs.public_enabled, bs.completed_at, c.slug,
           EXISTS (SELECT 1 FROM public.booking_services service WHERE service.bucket_id = bs.bucket_id AND service.active = true) AS has_active_services
    FROM public.booking_setup bs
    JOIN public.clients c ON c.id = bs.bucket_id
    WHERE bs.bucket_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{
    public_enabled: boolean;
    completed_at: string | null;
    slug: string;
    has_active_services: boolean;
  }>;
  const current = rows[0];
  if (!current) return jsonError(409, 'booking_setup_required');
  if (read)
    return jsonOk({
      enabled: current.public_enabled,
      publicUrl: publicUrl(current.slug),
      ready: !!current.completed_at && current.has_active_services,
    });

  const body = PublicationPut.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'invalid_body', { issues: body.error.issues });
  if (body.data.enabled && (!current.completed_at || !current.has_active_services))
    return jsonError(409, 'booking_not_ready_to_publish');
  await sql`UPDATE public.booking_setup SET public_enabled = ${body.data.enabled} WHERE bucket_id = ${a.ctx.clientId}::uuid`;
  await logAudit(sql, {
    session: {
      kind: 'bucket_user',
      user_node_id: a.ctx.userNodeId,
      client_id: a.ctx.clientId,
      level_number: a.ctx.levelNumber,
    },
    op: 'booking.publication_toggled',
    clientId: a.ctx.clientId,
    targetType: 'booking_setup',
    targetId: a.ctx.clientId,
    detail: { enabled: body.data.enabled },
  });
  return jsonOk({
    enabled: body.data.enabled,
    publicUrl: publicUrl(current.slug),
    ready: !!current.completed_at && current.has_active_services,
  });
}
