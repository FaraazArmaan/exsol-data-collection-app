import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from './_shared/db';
import { decryptPaymentSecret, PaymentsEncryptionUnavailable } from './_payments-secrets';

export class RazorpayProviderError extends Error {}

export interface RazorpayConnection {
  keyId: string;
  apiSecret: string;
  webhookSecret: string;
}

export async function getRazorpayTestConnection(clientId: string): Promise<RazorpayConnection | null> {
  const rows = (await db()`
    SELECT key_id, api_secret_enc, webhook_secret_enc
    FROM public.payment_provider_connections
    WHERE client_id = ${clientId}::uuid AND provider = 'razorpay' AND mode = 'test' AND enabled = true
    LIMIT 1
  `) as Array<{ key_id: string; api_secret_enc: string; webhook_secret_enc: string }>;
  const row = rows[0];
  if (!row) return null;
  try {
    return {
      keyId: row.key_id,
      apiSecret: decryptPaymentSecret(row.api_secret_enc),
      webhookSecret: decryptPaymentSecret(row.webhook_secret_enc),
    };
  } catch (error) {
    if (error instanceof PaymentsEncryptionUnavailable) throw error;
    throw error;
  }
}

export async function razorpayTestConnectionReady(clientId: string): Promise<boolean> {
  const rows = await db()`
    SELECT 1
    FROM public.payment_provider_connections
    WHERE client_id = ${clientId}::uuid AND provider = 'razorpay' AND mode = 'test' AND enabled = true
      AND key_id IS NOT NULL AND api_secret_enc IS NOT NULL AND webhook_secret_enc IS NOT NULL
    LIMIT 1
  `;
  return rows.length === 1;
}

export async function createRazorpayOrder(input: {
  connection: Pick<RazorpayConnection, 'keyId' | 'apiSecret'>;
  amountMinor: number;
  currency: 'INR';
  receipt: string;
  notes: Record<string, string>;
}): Promise<{ id: string; amount: number; currency: string }> {
  let response: Response;
  try {
    response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${input.connection.keyId}:${input.connection.apiSecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: input.amountMinor, currency: input.currency, receipt: input.receipt, notes: input.notes }),
    });
  } catch {
    throw new RazorpayProviderError('razorpay_unreachable');
  }
  const body = await response.json().catch(() => null) as { id?: unknown; amount?: unknown; currency?: unknown } | null;
  if (!response.ok || typeof body?.id !== 'string' || typeof body.amount !== 'number' || typeof body.currency !== 'string') {
    throw new RazorpayProviderError('razorpay_order_failed');
  }
  return { id: body.id, amount: body.amount, currency: body.currency };
}

export function verifyRazorpayWebhook(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = Buffer.from(signature, 'utf8');
  const calculated = Buffer.from(expected, 'utf8');
  return received.length === calculated.length && timingSafeEqual(received, calculated);
}
