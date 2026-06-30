// GET/PUT /api/booking/settings — tenant booking configuration (single row per bucket).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { SettingsPut } from './_booking-validators';

export const config = { path: '/api/booking/settings', method: ['GET', 'PUT'] };

const DEFAULTS = {
  slot_interval_min: 15, lead_time_min: 0, cancel_cutoff_min: 0,
  weekly_schedule: {}, date_overrides: [],
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireBooking(req, ['booking.employees.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT slot_interval_min, lead_time_min, cancel_cutoff_min, weekly_schedule, date_overrides
      FROM public.booking_settings WHERE bucket_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    return jsonOk(rows[0] ?? DEFAULTS);
  }
  if (req.method === 'PUT') {
    const a = await requireBooking(req, ['booking.employees.edit']);
    if (!a.ok) return a.res;
    let body: SettingsPut;
    try { body = SettingsPut.parse(await req.json()); }
    catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }
    const sql = db();
    const rows = (await sql`
      INSERT INTO public.booking_settings
        (bucket_id, slot_interval_min, lead_time_min, cancel_cutoff_min, weekly_schedule, date_overrides)
      VALUES (${a.ctx.clientId}::uuid, ${body.slot_interval_min}, ${body.lead_time_min},
              ${body.cancel_cutoff_min}, ${JSON.stringify(body.weekly_schedule)}::jsonb,
              ${JSON.stringify(body.date_overrides)}::jsonb)
      ON CONFLICT (bucket_id) DO UPDATE SET
        slot_interval_min = EXCLUDED.slot_interval_min, lead_time_min = EXCLUDED.lead_time_min,
        cancel_cutoff_min = EXCLUDED.cancel_cutoff_min, weekly_schedule = EXCLUDED.weekly_schedule,
        date_overrides = EXCLUDED.date_overrides, updated_at = now()
      RETURNING slot_interval_min, lead_time_min, cancel_cutoff_min, weekly_schedule, date_overrides
    `) as any[];
    return jsonOk(rows[0]);
  }
  return new Response('Method Not Allowed', { status: 405 });
}
