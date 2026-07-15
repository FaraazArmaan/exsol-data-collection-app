import { db } from './_shared/db';
import {
  createRazorpayOrder, getRazorpayTestConnection, RazorpayProviderError,
} from './_payments-razorpay';

const HOLD_MINUTES = 15;

type CheckoutSource = {
  clientId: string;
  sourceType: 'booking_visit' | 'sale';
  sourceId: string;
  purpose: 'deposit' | 'full_upfront' | 'sale_total';
  amountMinor: number;
  snapshot: Record<string, string>;
};

export interface RazorpayCheckout {
  orderId: string;
  keyId: string;
  amountMinor: number;
  currency: 'INR';
  expiresAt: string;
}

async function createRazorpayCheckout(input: CheckoutSource): Promise<RazorpayCheckout | null> {
  const sql = db();
  const requests = (await sql`
    INSERT INTO public.payment_requests
      (client_id, source_type, source_id, purpose, amount_minor, currency, expires_at, source_snapshot)
    VALUES (
      ${input.clientId}::uuid, ${input.sourceType}, ${input.sourceId}::uuid, ${input.purpose},
      ${input.amountMinor}, 'INR', now() + make_interval(mins => ${HOLD_MINUTES}), ${JSON.stringify(input.snapshot)}::jsonb
    )
    ON CONFLICT (client_id, source_type, source_id, purpose) DO UPDATE
      SET expires_at = EXCLUDED.expires_at, updated_at = now()
      WHERE public.payment_requests.status = 'open'
    RETURNING id, expires_at
  `) as Array<{ id: string; expires_at: string }>;
  const request = requests[0];
  if (!request) return null;

  const connection = await getRazorpayTestConnection(input.clientId);
  if (!connection) throw new RazorpayProviderError('razorpay_not_configured');
  const attempts = (await sql`
    SELECT provider_order_id, expires_at
    FROM public.payment_attempts
    WHERE request_id = ${request.id}::uuid AND provider = 'razorpay' AND status = 'created'
      AND expires_at > now()
    ORDER BY created_at DESC
    LIMIT 1
  `) as Array<{ provider_order_id: string; expires_at: string }>;
  if (attempts[0]) {
    return {
      orderId: attempts[0].provider_order_id, keyId: connection.keyId,
      amountMinor: input.amountMinor, currency: 'INR', expiresAt: attempts[0].expires_at,
    };
  }

  const order = await createRazorpayOrder({
    connection, amountMinor: input.amountMinor, currency: 'INR',
    receipt: `pay_${request.id.replace(/-/g, '').slice(0, 32)}`,
    notes: { payment_request_id: request.id, [input.sourceType]: input.sourceId },
  });
  if (order.amount !== input.amountMinor || order.currency !== 'INR') {
    throw new RazorpayProviderError('razorpay_order_mismatch');
  }
  const inserted = (await sql`
    INSERT INTO public.payment_attempts
      (client_id, request_id, provider, status, provider_order_id, amount_minor, currency, expires_at)
    VALUES (
      ${input.clientId}::uuid, ${request.id}::uuid, 'razorpay', 'created', ${order.id},
      ${input.amountMinor}, 'INR', ${request.expires_at}::timestamptz
    )
    RETURNING expires_at
  `) as Array<{ expires_at: string }>;
  return { orderId: order.id, keyId: connection.keyId, amountMinor: input.amountMinor, currency: 'INR', expiresAt: inserted[0]!.expires_at };
}

export function createBookingRazorpayCheckout(input: {
  clientId: string;
  visitId: string;
  amountMinor: number;
  purpose: 'deposit' | 'full_upfront';
}) {
  return createRazorpayCheckout({
    clientId: input.clientId, sourceType: 'booking_visit', sourceId: input.visitId,
    purpose: input.purpose, amountMinor: input.amountMinor,
    snapshot: { booking_visit_id: input.visitId, purpose: input.purpose },
  });
}

export function createSaleRazorpayCheckout(input: { clientId: string; saleId: string; amountMinor: number }) {
  return createRazorpayCheckout({
    clientId: input.clientId, sourceType: 'sale', sourceId: input.saleId,
    purpose: 'sale_total', amountMinor: input.amountMinor,
    snapshot: { sale_id: input.saleId, purpose: 'sale_total' },
  });
}
