import { db } from './_shared/db';
import { requireMarketing } from './_marketing-authz';
import { jsonError } from './_shared/http';
import { exportCustomerData } from './_marketing-gdpr';

// GET /api/marketing/gdpr/export?email=... — full per-person data bundle (JSON).
export const config = { path: '/api/marketing/gdpr/export', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireMarketing(req, ['marketing.customers.view']);
  if (!a.ok) return a.res;
  const email = (new URL(req.url).searchParams.get('email') ?? '').trim();
  if (!email) return jsonError(400, 'invalid_input');

  const bundle = await exportCustomerData(db(), a.ctx.clientId, email);
  return new Response(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="gdpr-export-${email.replace(/[^a-z0-9._@-]/gi, '_')}.json"`,
    },
  });
}
