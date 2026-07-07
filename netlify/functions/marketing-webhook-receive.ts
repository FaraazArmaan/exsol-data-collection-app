import { db } from './_shared/db';
import { jsonOk, jsonError } from './_shared/http';
import { verifyHmacSignature } from './_shared/webhook';
import { fireTriggers } from './_marketing-triggers';
import { deliver } from './_shared/resend';

// POST /api/marketing/webhook/:token — PUBLIC signed inbound webhook.
// The token (path) resolves the tenant + its per-endpoint HMAC secret; the
// signature is verified over the RAW body (never req.json() first — re-serialising
// breaks the MAC). Verified events are stored, then matching triggers fire.
export const config = { path: '/api/marketing/webhook/:token', method: 'POST' };

const SIGNATURE_HEADER = 'x-exsol-signature';

export default async function handler(req: Request): Promise<Response> {
  const token = new URL(req.url).pathname.split('/').pop() ?? '';
  const rawBody = await req.text(); // RAW bytes — do NOT parse before verifying

  const sql = db();
  const ep = (await sql`
    SELECT id, client_id, secret FROM public.marketing_webhook_endpoints
    WHERE token = ${token} AND active = true
  `) as Array<{ id: string; client_id: string; secret: string }>;
  if (!ep[0]) return jsonError(404, 'not_found'); // unknown token — don't leak

  const signature = req.headers.get(SIGNATURE_HEADER) ?? '';
  if (!verifyHmacSignature(rawBody, signature, ep[0].secret)) {
    return jsonError(401, 'invalid_signature');
  }

  let payload: Record<string, unknown>;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const eventType = typeof payload.event_type === 'string' ? payload.event_type
    : typeof payload.type === 'string' ? payload.type
    : 'unknown';

  const ev = (await sql`
    INSERT INTO public.marketing_webhook_events (client_id, endpoint_id, event_type, payload)
    VALUES (${ep[0].client_id}::uuid, ${ep[0].id}::uuid, ${eventType}, ${JSON.stringify(payload)}::jsonb)
    RETURNING id
  `) as Array<{ id: string }>;

  const triggered = await fireTriggers(sql, ep[0].client_id, eventType, payload, { deliverEmail: deliver });
  if (triggered > 0) {
    await sql`UPDATE public.marketing_webhook_events SET triggered_count = ${triggered} WHERE id = ${ev[0]!.id}::uuid`;
  }

  return jsonOk({ received: true, event_id: ev[0]!.id, event_type: eventType, triggered });
}
