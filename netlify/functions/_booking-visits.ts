import { randomUUID } from 'node:crypto';
import { db } from './_shared/db';
import {
  getPublicAvailability,
  validateReservation,
  type ReservationService,
} from './_booking-reservation';
import type { Slot } from '../../src/modules/booking/lib/availability';
import { addMinutes } from '../../src/modules/booking/lib/tz';
import { getBookingPolicy } from './_booking-policy';
import { appendBookingEvent, type BookingEventSource } from './_booking-events';

export interface VisitPlanLine {
  id: string;
  service: ReservationService;
  resourceId: string;
  startIso: string;
  endIso: string;
  capacityEndIso: string;
}

export type VisitPlan =
  | { ok: true; lines: VisitPlanLine[]; startIso: string; endIso: string; priceCents: number }
  | { ok: false; code: string };

export async function validateSequentialVisit(input: {
  clientId: string;
  serviceIds: string[];
  resourceId: string | 'any';
  start: string;
  allowAvailabilityOverride?: boolean;
  excludeBookingId?: string;
}): Promise<VisitPlan> {
  if (input.serviceIds.length === 0 || new Set(input.serviceIds).size !== input.serviceIds.length) {
    return { ok: false, code: 'invalid_services' };
  }
  const lines: VisitPlanLine[] = [];
  let start = input.start;
  let resourceId = input.resourceId;
  for (const [index, serviceId] of input.serviceIds.entries()) {
    const reservation = await validateReservation({
      clientId: input.clientId,
      serviceId,
      resourceId,
      start,
      allowAvailabilityOverride: input.allowAvailabilityOverride,
      allowOffGrid: index > 0,
      excludeBookingId: input.excludeBookingId,
    });
    if (!reservation.ok) return reservation;
    lines.push({
      id: randomUUID(),
      service: reservation.service,
      resourceId: reservation.resourceId,
      startIso: reservation.startIso,
      endIso: reservation.endIso,
      capacityEndIso: addMinutes(
        new Date(reservation.endIso),
        reservation.service.buffer_min,
      ).toISOString(),
    });
    start = lines[lines.length - 1]!.capacityEndIso;
    resourceId = reservation.resourceId;
  }
  return {
    ok: true,
    lines,
    startIso: lines[0]!.startIso,
    endIso: lines[lines.length - 1]!.endIso,
    priceCents: lines.reduce((total, line) => total + Number(line.service.price_cents), 0),
  };
}

export async function getSequentialVisitAvailability(input: {
  clientId: string;
  timeZone: string;
  serviceIds: string[];
  date: string;
  resourceId: string | 'any';
}): Promise<{ serviceFound: boolean; slots: Slot[]; bookingCounts: Map<string, number> }> {
  const firstServiceId = input.serviceIds[0];
  if (!firstServiceId || new Set(input.serviceIds).size !== input.serviceIds.length) {
    return { serviceFound: false, slots: [], bookingCounts: new Map() };
  }
  const first = await getPublicAvailability({
    clientId: input.clientId,
    timeZone: input.timeZone,
    serviceId: firstServiceId,
    date: input.date,
    resourceId: input.resourceId,
  });
  if (!first.service) return { serviceFound: false, slots: [], bookingCounts: first.bookingCounts };
  if (input.serviceIds.length === 1) {
    return { serviceFound: true, slots: first.slots, bookingCounts: first.bookingCounts };
  }
  const slots: Slot[] = [];
  for (const firstSlot of first.slots) {
    const plan = await validateSequentialVisit({
      clientId: input.clientId,
      serviceIds: input.serviceIds,
      resourceId: firstSlot.resourceId,
      start: firstSlot.startUtc.toISOString(),
    });
    if (plan.ok) {
      slots.push({
        startUtc: new Date(plan.startIso),
        endUtc: new Date(plan.endIso),
        resourceId: firstSlot.resourceId,
      });
    }
  }
  return { serviceFound: true, slots, bookingCounts: first.bookingCounts };
}

export async function createVisit(input: {
  clientId: string;
  userNodeId: string;
  customer: { name: string; phone: string; email?: string };
  plan: Extract<VisitPlan, { ok: true }>;
  status: 'pending' | 'confirmed';
  paymentStatus?: 'cash_pending' | 'payment_requested' | 'paid' | 'waived';
  manageToken?: string;
  createdByUserNodeId?: string;
  depositPaidCents?: number;
  eventSource?: BookingEventSource;
}): Promise<{ visitId: string; bookingId: string }> {
  const sql = db();
  const policy = await getBookingPolicy(input.clientId);
  const visitId = randomUUID();
  const bookingId = randomUUID();
  const first = input.plan.lines[0]!;
  const queries = [
    sql`
      INSERT INTO public.booking_visits (
        id, bucket_id, user_node_id, time_range, status, customer_name, customer_phone,
        customer_email, price_cents, deposit_paid_cents, manage_token, created_by_user_node,
        policy_snapshot, payment_status
      )
      VALUES (
        ${visitId}::uuid, ${input.clientId}::uuid, ${input.userNodeId}::uuid,
        tstzrange(${input.plan.startIso}::timestamptz, ${input.plan.endIso}::timestamptz),
        ${input.status}::booking_status, ${input.customer.name}, ${input.customer.phone},
        ${input.customer.email ?? null}, ${input.plan.priceCents}, ${input.depositPaidCents ?? 0},
        ${input.manageToken ?? null}, ${input.createdByUserNodeId ?? null}::uuid,
        ${JSON.stringify(policy)}::jsonb,
        ${input.paymentStatus ?? (input.status === 'confirmed' ? 'cash_pending' : 'payment_requested')}::booking_payment_status
      )
    `,
    ...input.plan.lines.flatMap((line, index) => [
      sql`
        INSERT INTO public.booking_appointment_lines (
          id, visit_id, service_id, sequence_number, resource_id, time_range,
          duration_min, buffer_min, price_cents
        )
        VALUES (
          ${line.id}::uuid, ${visitId}::uuid, ${line.service.id}::uuid, ${index + 1},
          ${line.resourceId}::uuid, tstzrange(${line.startIso}::timestamptz, ${line.endIso}::timestamptz),
          ${line.service.duration_min}, ${line.service.buffer_min}, ${line.service.price_cents}
        )
      `,
      sql`
        INSERT INTO public.booking_line_reservations (visit_id, appointment_line_id, resource_id, time_range, status)
        VALUES (
          ${visitId}::uuid, ${line.id}::uuid, ${line.resourceId}::uuid,
          tstzrange(${line.startIso}::timestamptz, ${line.capacityEndIso}::timestamptz), ${input.status}::booking_status
        )
      `,
    ]),
    sql`
      INSERT INTO public.bookings (
        id, visit_id, appointment_line_id, bucket_id, service_id, resource_id, user_node_id,
        time_range, status, customer_name, customer_phone, customer_email, price_cents,
        deposit_paid_cents, manage_token, created_by_user_node
      )
      VALUES (
        ${bookingId}::uuid, ${visitId}::uuid, ${first.id}::uuid, ${input.clientId}::uuid,
        ${first.service.id}::uuid, ${first.resourceId}::uuid, ${input.userNodeId}::uuid,
        tstzrange(${input.plan.startIso}::timestamptz, ${input.plan.endIso}::timestamptz),
        ${input.status}::booking_status, ${input.customer.name}, ${input.customer.phone},
        ${input.customer.email ?? null}, ${input.plan.priceCents}, ${input.depositPaidCents ?? 0},
        ${input.manageToken ?? null}, ${input.createdByUserNodeId ?? null}::uuid
      )
    `,
    appendBookingEvent(sql, {
      visitId,
      clientId: input.clientId,
      actorUserNodeId: input.createdByUserNodeId ?? input.userNodeId,
      source: input.eventSource ?? 'vendor',
      eventType: 'visit_created',
      newState: {
        appointment_status: input.status,
        payment_status:
          input.paymentStatus ??
          (input.status === 'confirmed' ? 'cash_pending' : 'payment_requested'),
        start_at: input.plan.startIso,
        end_at: input.plan.endIso,
      },
    }),
  ];
  await sql.transaction(queries as never);
  return { visitId, bookingId };
}

export async function rescheduleVisit(input: {
  visitId: string;
  clientId: string;
  resourceId: string;
  start: string;
  allowAvailabilityOverride?: boolean;
  incrementCustomerRescheduleCount?: boolean;
  eventSource?: BookingEventSource;
  actorUserNodeId?: string | null;
}): Promise<VisitPlan> {
  const sql = db();
  const visitRows = (await sql`
    SELECT v.status, v.payment_status, lower(v.time_range) AS start_at, upper(v.time_range) AS end_at,
           b.id AS booking_id FROM public.booking_visits v
    JOIN public.bookings b ON b.visit_id = v.id
    WHERE v.id = ${input.visitId}::uuid AND v.bucket_id = ${input.clientId}::uuid
    LIMIT 1
  `) as Array<{
    status: 'pending' | 'confirmed';
    payment_status: string;
    start_at: string;
    end_at: string;
    booking_id: string;
  }>;
  if (!visitRows[0]) return { ok: false, code: 'visit_not_found' };
  const lines = (await sql`
    SELECT id, service_id
    FROM public.booking_appointment_lines
    WHERE visit_id = ${input.visitId}::uuid
    ORDER BY sequence_number
  `) as Array<{ id: string; service_id: string }>;
  const plan = await validateSequentialVisit({
    clientId: input.clientId,
    serviceIds: lines.map((line) => line.service_id),
    resourceId: input.resourceId,
    start: input.start,
    allowAvailabilityOverride: input.allowAvailabilityOverride,
    excludeBookingId: visitRows[0]!.booking_id,
  });
  if (!plan.ok) return plan;
  const queries = [
    sql`
      UPDATE public.booking_line_reservations
      SET status = 'cancelled'::booking_status
      WHERE visit_id = ${input.visitId}::uuid
    `,
    sql`
      UPDATE public.booking_visits
      SET time_range = tstzrange(${plan.startIso}::timestamptz, ${plan.endIso}::timestamptz),
          reschedule_count = reschedule_count + ${input.incrementCustomerRescheduleCount ? 1 : 0},
          updated_at = now()
      WHERE id = ${input.visitId}::uuid
    `,
    ...plan.lines.flatMap((line, index) => [
      sql`
        UPDATE public.booking_appointment_lines
        SET resource_id = ${line.resourceId}::uuid,
            time_range = tstzrange(${line.startIso}::timestamptz, ${line.endIso}::timestamptz)
        WHERE id = ${lines[index]!.id}::uuid
      `,
      sql`
        UPDATE public.booking_line_reservations
        SET resource_id = ${line.resourceId}::uuid,
            time_range = tstzrange(${line.startIso}::timestamptz, ${line.capacityEndIso}::timestamptz),
            status = ${visitRows[0]!.status}::booking_status
        WHERE appointment_line_id = ${lines[index]!.id}::uuid
      `,
    ]),
    sql`
      UPDATE public.bookings
      SET resource_id = ${plan.lines[0]!.resourceId}::uuid,
          time_range = tstzrange(${plan.startIso}::timestamptz, ${plan.endIso}::timestamptz),
          updated_at = now()
      WHERE visit_id = ${input.visitId}::uuid
    `,
    appendBookingEvent(sql, {
      visitId: input.visitId,
      clientId: input.clientId,
      actorUserNodeId: input.actorUserNodeId,
      source: input.eventSource ?? 'vendor',
      eventType: 'visit_rescheduled',
      previousState: { start_at: visitRows[0]!.start_at, end_at: visitRows[0]!.end_at },
      newState: { start_at: plan.startIso, end_at: plan.endIso },
    }),
  ];
  await sql.transaction(queries as never);
  return plan;
}

export async function setVisitStatus(input: {
  visitId: string;
  clientId: string;
  status: 'cancelled' | 'completed' | 'no_show';
  reason?: string | null;
  eventSource: BookingEventSource;
  actorUserNodeId?: string | null;
}): Promise<void> {
  const sql = db();
  const visits = (await sql`
    SELECT status, payment_status FROM public.booking_visits WHERE id = ${input.visitId}::uuid LIMIT 1
  `) as Array<{ status: string; payment_status: string }>;
  if (!visits[0]) return;
  await sql.transaction([
    sql`
      UPDATE public.booking_visits
      SET status = ${input.status}::booking_status,
          cancelled_at = ${input.status === 'cancelled' ? new Date().toISOString() : null}::timestamptz,
          cancellation_reason = ${input.status === 'cancelled' ? (input.reason ?? null) : null},
          updated_at = now()
      WHERE id = ${input.visitId}::uuid
    `,
    sql`
      UPDATE public.booking_line_reservations
      SET status = ${input.status}::booking_status
      WHERE visit_id = ${input.visitId}::uuid
    `,
    sql`
      UPDATE public.bookings
      SET status = ${input.status}::booking_status,
          cancelled_at = ${input.status === 'cancelled' ? new Date().toISOString() : null}::timestamptz,
          cancellation_reason = ${input.status === 'cancelled' ? (input.reason ?? null) : null},
          updated_at = now()
      WHERE visit_id = ${input.visitId}::uuid
    `,
    appendBookingEvent(sql, {
      visitId: input.visitId,
      clientId: input.clientId,
      actorUserNodeId: input.actorUserNodeId,
      source: input.eventSource,
      eventType: `visit_${input.status}`,
      previousState: {
        appointment_status: visits[0]!.status,
        payment_status: visits[0]!.payment_status,
      },
      newState: { appointment_status: input.status, payment_status: visits[0]!.payment_status },
      reason: input.reason,
    }),
  ]);
}

export async function recordVisitCashPayment(input: {
  visitId: string;
  clientId: string;
  actorUserNodeId: string;
  amountCents?: number;
  reference?: string | null;
}): Promise<{ status: string; paymentStatus: string; paidCents: number } | null> {
  const sql = db();
  const visits = (await sql`
    SELECT status, payment_status, price_cents, deposit_paid_cents
    FROM public.booking_visits
    WHERE id = ${input.visitId}::uuid AND bucket_id = ${input.clientId}::uuid
    LIMIT 1
  `) as Array<{
    status: string;
    payment_status: string;
    price_cents: number;
    deposit_paid_cents: number;
  }>;
  const visit = visits[0];
  if (!visit) return null;
  const amountCents =
    input.amountCents ?? Math.max(0, Number(visit.price_cents) - Number(visit.deposit_paid_cents));
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null;
  const paidCents = Math.min(
    Number(visit.price_cents),
    Number(visit.deposit_paid_cents) + amountCents,
  );
  const paymentStatus = paidCents >= Number(visit.price_cents) ? 'paid' : 'partly_paid';
  const appointmentStatus =
    visit.status === 'pending' && paymentStatus === 'paid' ? 'confirmed' : visit.status;
  await sql.transaction([
    sql`
      UPDATE public.booking_visits
      SET status = ${appointmentStatus}::booking_status,
          payment_status = ${paymentStatus}::booking_payment_status,
          deposit_paid_cents = ${paidCents}, updated_at = now()
      WHERE id = ${input.visitId}::uuid
    `,
    sql`
      UPDATE public.booking_line_reservations
      SET status = ${appointmentStatus}::booking_status
      WHERE visit_id = ${input.visitId}::uuid
    `,
    sql`
      UPDATE public.bookings
      SET status = ${appointmentStatus}::booking_status,
          deposit_paid_cents = ${paidCents}, updated_at = now()
      WHERE visit_id = ${input.visitId}::uuid
    `,
    appendBookingEvent(sql, {
      visitId: input.visitId,
      clientId: input.clientId,
      actorUserNodeId: input.actorUserNodeId,
      source: 'vendor',
      eventType: 'offline_cash_received',
      previousState: {
        appointment_status: visit.status,
        payment_status: visit.payment_status,
        paid_cents: Number(visit.deposit_paid_cents),
      },
      newState: {
        appointment_status: appointmentStatus,
        payment_status: paymentStatus,
        paid_cents: paidCents,
      },
      reference: input.reference,
    }),
  ]);
  return { status: appointmentStatus, paymentStatus, paidCents };
}

export async function checkInVisit(input: {
  visitId: string;
  clientId: string;
  actorUserNodeId: string;
}): Promise<boolean> {
  const sql = db();
  const rows = (await sql`
    SELECT status, payment_status FROM public.booking_visits
    WHERE id = ${input.visitId}::uuid AND bucket_id = ${input.clientId}::uuid
    LIMIT 1
  `) as Array<{ status: string; payment_status: string }>;
  if (rows[0]?.status !== 'confirmed') return false;
  await sql.transaction([
    appendBookingEvent(sql, {
      visitId: input.visitId,
      clientId: input.clientId,
      actorUserNodeId: input.actorUserNodeId,
      source: 'vendor',
      eventType: 'visit_checked_in',
      previousState: { appointment_status: rows[0].status, payment_status: rows[0].payment_status },
      newState: { appointment_status: rows[0].status, payment_status: rows[0].payment_status },
    }),
  ]);
  return true;
}
