// GET /api/email/outbox — vendor outbox: the client's transactional email log.
// Bucket-scoped to the caller's client. Includes body_html so the UI can
// preview a send without a second round-trip (demo volumes are small).
import { jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { requireEmail } from './_email-authz';

export const config = { path: '/api/email/outbox', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireEmail(req, ['email.customers.view']);
  if (!a.ok) return a.res;

  const sql = db();
  const rows = (await sql`
    SELECT id, to_email, template, subject, status, provider_id, error, body_html,
           created_at, sent_at
    FROM public.email_outbox
    WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY created_at DESC
    LIMIT 200
  `) as any[];
  return jsonOk({ emails: rows });
}
