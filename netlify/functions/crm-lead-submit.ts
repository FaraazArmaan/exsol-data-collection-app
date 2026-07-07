// POST /api/crm/lead-submit — PUBLIC (unauthenticated) lead-capture form.
// Body: { slug, name, email?, phone?, message?, honeypot? }. Anti-abuse:
//   1. honeypot — a filled hidden field ⇒ silently "succeed" (don't tip off bots)
//   2. per-IP + per-slug rate limit (Netlify Blobs, best-effort)
//   3. tenant must exist with the CRM module enabled (else 404, no reason leaked)
// Writes a crm_leads row (status 'new'). Never reveals whether the tenant exists.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveCrmTenant } from './_crm-public';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { LeadSubmit } from './_crm-validators';

export const config = { path: '/api/crm/lead-submit', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  let raw: any;
  try { raw = await req.json(); } catch { return jsonError(400, 'invalid_body'); }

  // Honeypot — real users never fill it. Pretend success so bots learn nothing.
  if (typeof raw?.honeypot === 'string' && raw.honeypot !== '') return jsonOk({ ok: true });

  let body: LeadSubmit;
  try { body = LeadSubmit.parse(raw); } catch (e: any) { return jsonError(400, 'invalid_body', { issues: e?.issues }); }

  const email = body.email?.trim() || null;
  const phone = body.phone?.trim() || null;
  if (!email && !phone) return jsonError(400, 'contact_required');

  // Rate-limit before touching the DB — cheap abuse protection on the slug string.
  const rl = await checkLimit(clientIp(req), 'crm_lead', {
    perMinute: 8,
    perSlugIp: { slug: body.slug, per10min: 5 },
  });
  if (!rl.ok) return jsonError(429, rl.code);

  const tenant = await resolveCrmTenant(body.slug);
  if (!tenant) return jsonError(404, 'not_available');

  const sql = db();
  await sql`
    INSERT INTO public.crm_leads (client_id, name, email, phone, message, source, status)
    VALUES (${tenant.clientId}::uuid, ${body.name.trim()}, ${email}, ${phone},
            ${body.message?.trim() || null}, 'public_form', 'new')
  `;
  return jsonOk({ ok: true });
}
