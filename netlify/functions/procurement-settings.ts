// /api/procurement/settings — per-client procurement settings.
//   GET   → { po_approval_threshold_cents }
//   PATCH → set the PO approval threshold (0 = no approval required).
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/settings', method: ['GET', 'PATCH'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT po_approval_threshold_cents FROM public.clients WHERE id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ po_approval_threshold_cents: string }>;
    return jsonOk({ po_approval_threshold_cents: Number(rows[0]?.po_approval_threshold_cents ?? 0) });
  }

  if (req.method === 'PATCH') {
    const a = await requireProcurement(req, ['procurement.products.edit']);
    if (!a.ok) return a.res;
    let body: { po_approval_threshold_cents?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const threshold = typeof body.po_approval_threshold_cents === 'number' ? Math.trunc(body.po_approval_threshold_cents) : NaN;
    if (!Number.isFinite(threshold) || threshold < 0) return jsonError(400, 'invalid_threshold');

    const sql = db();
    await sql`
      UPDATE public.clients SET po_approval_threshold_cents = ${threshold}::bigint WHERE id = ${a.ctx.clientId}::uuid
    `;
    return jsonOk({ po_approval_threshold_cents: threshold });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
