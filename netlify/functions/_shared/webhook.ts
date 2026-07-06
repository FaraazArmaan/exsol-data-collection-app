// HMAC webhook-signature verification, generalised from _booking-razorpay.ts so
// every inbound-webhook receiver shares one constant-time check.
//
// The signature is HMAC(algorithm, secret) over the RAW request body, in the
// given encoding. Offline-deterministic → fully unit-testable, no live provider.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface HmacOptions {
  /** HMAC digest algorithm — default 'sha256'. */
  algorithm?: string;
  /** Encoding of the incoming signature string — default 'hex'. */
  encoding?: 'hex' | 'base64';
}

/**
 * Constant-time verification that `signature` is HMAC(secret) over `rawBody`.
 * Returns false (never throws) on any mismatch, length difference, or bad input.
 */
export function verifyHmacSignature(
  rawBody: string,
  signature: string,
  secret: string,
  opts: HmacOptions = {},
): boolean {
  if (!rawBody || !signature || !secret) return false;
  let expected: string;
  try {
    expected = createHmac(opts.algorithm ?? 'sha256', secret).update(rawBody).digest(opts.encoding ?? 'hex');
  } catch {
    return false;
  }
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}
