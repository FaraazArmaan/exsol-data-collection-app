import { db } from './_shared/db';

export const DEFAULT_BOOKING_POLICY = {
  version: 1,
  cancel_cutoff_min: 1440,
  reschedule_cutoff_min: 1440,
  max_customer_reschedules: 3,
  late_arrival_grace_min: 15,
  no_show_outcome: 'staff_review' as const,
  cancellation_settlement: 'forfeit_deposit' as const,
  late_reschedule_action: 'staff_approval' as const,
  late_reschedule_fee_cents: 0,
  deposit_requirement: 'service_defined' as const,
};

export type BookingPolicy = typeof DEFAULT_BOOKING_POLICY;

export function policyFromRow(row?: Partial<BookingPolicy>): BookingPolicy {
  return {
    ...DEFAULT_BOOKING_POLICY,
    ...row,
    version: Number(row?.version ?? DEFAULT_BOOKING_POLICY.version),
    cancel_cutoff_min: Number(row?.cancel_cutoff_min ?? DEFAULT_BOOKING_POLICY.cancel_cutoff_min),
    reschedule_cutoff_min: Number(
      row?.reschedule_cutoff_min ?? DEFAULT_BOOKING_POLICY.reschedule_cutoff_min,
    ),
    max_customer_reschedules: Number(
      row?.max_customer_reschedules ?? DEFAULT_BOOKING_POLICY.max_customer_reschedules,
    ),
    late_arrival_grace_min: Number(
      row?.late_arrival_grace_min ?? DEFAULT_BOOKING_POLICY.late_arrival_grace_min,
    ),
    late_reschedule_fee_cents: Number(
      row?.late_reschedule_fee_cents ?? DEFAULT_BOOKING_POLICY.late_reschedule_fee_cents,
    ),
  };
}

export async function getBookingPolicy(clientId: string): Promise<BookingPolicy> {
  const rows = (await db()`
    SELECT version, cancel_cutoff_min, reschedule_cutoff_min, max_customer_reschedules,
           late_arrival_grace_min, no_show_outcome, cancellation_settlement,
           late_reschedule_action, late_reschedule_fee_cents, deposit_requirement
    FROM public.booking_policies
    WHERE bucket_id = ${clientId}::uuid
    LIMIT 1
  `) as Array<Partial<BookingPolicy>>;
  return policyFromRow(rows[0]);
}
