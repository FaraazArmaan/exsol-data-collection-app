import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { TRACKING_GIF_BASE64 } from '../../src/modules/marketing/lib/tracking';

// GET /api/marketing/track/:kind — PUBLIC, unauthenticated (recipients open from
// their email client; there is no session). kind='open' returns a 1x1 gif and
// logs an open; kind='click' logs a click and 302-redirects to ?u=<url>.
//
// The event is tenant-scoped by looking up the send row (never trust a caller
// for client_id). Unknown/!uuid send ids are swallowed (still return the pixel)
// so the endpoint never leaks whether a send exists.
export const config = { path: '/api/marketing/track/:kind', method: 'GET' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIF = Buffer.from(TRACKING_GIF_BASE64, 'base64');

function pixel(): Response {
  return new Response(GIF, {
    status: 200,
    headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Content-Length': String(GIF.length) },
  });
}

async function logEvent(sendId: string, kind: 'open' | 'click', url: string | null): Promise<void> {
  if (!UUID_RE.test(sendId)) return;
  const sql = db();
  // Resolve the tenant + campaign from the send row — do NOT trust the caller.
  const rows = (await sql`
    SELECT client_id, campaign_id FROM public.campaign_sends WHERE id = ${sendId}::uuid
  `) as Array<{ client_id: string; campaign_id: string }>;
  if (!rows[0]) return;
  await sql`
    INSERT INTO public.marketing_campaign_events (client_id, campaign_id, send_id, kind, url)
    VALUES (${rows[0].client_id}::uuid, ${rows[0].campaign_id}::uuid, ${sendId}::uuid, ${kind}, ${url})
  `;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const kind = url.pathname.split('/').pop();
  const sendId = url.searchParams.get('s') ?? '';

  if (kind === 'open') {
    try { await logEvent(sendId, 'open', null); } catch { /* never break the pixel */ }
    return pixel();
  }

  if (kind === 'click') {
    const dest = url.searchParams.get('u') ?? '';
    // Only http(s) destinations — bounds the open-redirect surface to real links.
    if (!/^https?:\/\//i.test(dest)) return jsonError(400, 'invalid_redirect');
    try { await logEvent(sendId, 'click', dest.slice(0, 2048)); } catch { /* log best-effort */ }
    return new Response(null, { status: 302, headers: { Location: dest } });
  }

  return jsonError(404, 'not_found');
}
