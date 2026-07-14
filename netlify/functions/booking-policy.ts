import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { BookingPolicyPut } from './_booking-validators';
import { getBookingPolicy, policyFromRow } from './_booking-policy';

export const config = { path: '/api/booking/policy', method: ['GET', 'PUT'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireBooking(req, ['booking.employees.view']);
    if (!a.ok) return a.res;
    return jsonOk(await getBookingPolicy(a.ctx.clientId));
  }
  if (req.method !== 'PUT') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireBooking(req, ['booking.employees.edit']);
  if (!a.ok) return a.res;
  let body: BookingPolicyPut;
  try {
    body = BookingPolicyPut.parse(await req.json());
  } catch (error: any) {
    return jsonError(400, 'invalid_body', { issues: error?.issues });
  }
  const rows = (await db()`
    INSERT INTO public.booking_policies (
      bucket_id, cancel_cutoff_min, reschedule_cutoff_min, max_customer_reschedules,
      late_arrival_grace_min, no_show_outcome, cancellation_settlement,
      late_reschedule_action, late_reschedule_fee_cents, deposit_requirement
    )
    VALUES (
      ${a.ctx.clientId}::uuid, ${body.cancel_cutoff_min}, ${body.reschedule_cutoff_min},
      ${body.max_customer_reschedules}, ${body.late_arrival_grace_min},
      ${body.no_show_outcome}, ${body.cancellation_settlement}, ${body.late_reschedule_action},
      ${body.late_reschedule_fee_cents}, ${body.deposit_requirement}
    )
    ON CONFLICT (bucket_id) DO UPDATE SET
      version = public.booking_policies.version + 1,
      cancel_cutoff_min = EXCLUDED.cancel_cutoff_min,
      reschedule_cutoff_min = EXCLUDED.reschedule_cutoff_min,
      max_customer_reschedules = EXCLUDED.max_customer_reschedules,
      late_arrival_grace_min = EXCLUDED.late_arrival_grace_min,
      no_show_outcome = EXCLUDED.no_show_outcome,
      cancellation_settlement = EXCLUDED.cancellation_settlement,
      late_reschedule_action = EXCLUDED.late_reschedule_action,
      late_reschedule_fee_cents = EXCLUDED.late_reschedule_fee_cents,
      deposit_requirement = EXCLUDED.deposit_requirement,
      updated_at = now()
    RETURNING version, cancel_cutoff_min, reschedule_cutoff_min, max_customer_reschedules,
              late_arrival_grace_min, no_show_outcome, cancellation_settlement,
              late_reschedule_action, late_reschedule_fee_cents, deposit_requirement
  `) as Array<Record<string, unknown>>;
  return jsonOk(policyFromRow(rows[0]));
}
