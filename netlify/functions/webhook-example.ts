// POST /api/webhook-example — reference signed-webhook receiver.
//
// The canonical shape for receiving a third-party webhook on this platform:
//   1. read the RAW body — verification is over exact bytes; NEVER req.json()
//      before verifying (re-serialising changes the bytes and breaks the HMAC)
//   2. verify the signature header in constant time (_shared/webhook.ts)
//   3. 401 on a missing/invalid signature; parse + act only after it passes
//
// The shared secret comes from WEBHOOK_EXAMPLE_SECRET. Copy this file for a real
// receiver; mirrors _booking-razorpay.ts (Razorpay webhook). Documented in
// .claude/rules/api-conventions.md § Signed webhook receivers.
import { jsonOk, jsonError } from './_shared/http';
import { verifyHmacSignature } from './_shared/webhook';

export const config = { path: '/api/webhook-example', method: 'POST' };

const SIGNATURE_HEADER = 'x-exsol-signature';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const secret = process.env.WEBHOOK_EXAMPLE_SECRET;
  if (!secret) return jsonError(500, 'webhook_not_configured');

  const signature = req.headers.get(SIGNATURE_HEADER) ?? '';
  const rawBody = await req.text(); // RAW bytes — do NOT parse before verifying

  if (!verifyHmacSignature(rawBody, signature, secret)) {
    return jsonError(401, 'invalid_signature');
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  // Verified — safe to act on the payload (enqueue, persist, etc.).
  return jsonOk({ received: true, bytes: rawBody.length, has_payload: payload != null });
}
