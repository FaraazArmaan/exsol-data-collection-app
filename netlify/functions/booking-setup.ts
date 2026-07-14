// GET/PUT /api/booking/setup — editable Booking Setup onboarding state.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireBooking } from './_booking-authz';
import { BookingSetupPut } from './_booking-validators';
import { deriveBookingSetup, type BookingSetupInput } from '../../src/modules/booking/lib/setup';

export const config = { path: '/api/booking/setup', method: ['GET', 'PUT'] };

const DEFAULT_SETUP: BookingSetupInput = {
  booking_party_mode: 'any_team_member',
  bookable_kinds: ['appointment'],
  extra_capacity_needs: [],
  availability_source: 'workforce',
};

function present(
  row: (BookingSetupInput & { completed_at?: string | null; setup_version?: number }) | undefined,
) {
  const setup = row ?? DEFAULT_SETUP;
  return {
    ...setup,
    ...deriveBookingSetup(setup),
    completed_at: row?.completed_at ?? null,
    setup_version: row?.setup_version ?? 1,
    is_first_visit: !row?.completed_at,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const read = req.method === 'GET';
  const a = await requireBooking(req, [read ? 'booking.employees.view' : 'booking.employees.edit']);
  if (!a.ok) return a.res;
  const sql = db();

  if (read) {
    const rows = (await sql`
      SELECT booking_party_mode, bookable_kinds, extra_capacity_needs, availability_source,
             display_labels, completed_at, setup_version
      FROM public.booking_setup WHERE bucket_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as any[];
    return jsonOk(present(rows[0]));
  }
  if (req.method !== 'PUT') return new Response('Method Not Allowed', { status: 405 });

  let body: BookingSetupPut;
  try {
    body = BookingSetupPut.parse(await req.json());
  } catch (e: any) {
    return jsonError(400, 'invalid_body', { issues: e?.issues });
  }
  const derived = deriveBookingSetup(body);
  const rows = (await sql`
    INSERT INTO public.booking_setup
      (bucket_id, booking_party_mode, bookable_kinds, extra_capacity_needs, availability_source,
       display_labels, reservation_rules, completed_at)
    VALUES (${a.ctx.clientId}::uuid, ${body.booking_party_mode}, ${body.bookable_kinds},
            ${body.extra_capacity_needs}, ${body.availability_source},
            ${JSON.stringify(derived.display_labels)}::jsonb,
            ${JSON.stringify(derived.reservation_rules)}::jsonb, now())
    ON CONFLICT (bucket_id) DO UPDATE SET
      booking_party_mode = EXCLUDED.booking_party_mode,
      bookable_kinds = EXCLUDED.bookable_kinds,
      extra_capacity_needs = EXCLUDED.extra_capacity_needs,
      availability_source = EXCLUDED.availability_source,
      display_labels = EXCLUDED.display_labels,
      reservation_rules = EXCLUDED.reservation_rules,
      completed_at = now(),
      setup_version = public.booking_setup.setup_version + 1
    RETURNING booking_party_mode, bookable_kinds, extra_capacity_needs, availability_source,
              display_labels, completed_at, setup_version
  `) as any[];
  return jsonOk(present(rows[0]));
}
