// GET/PUT /api/brand-site — authed Brand Portfolio Site editor config for the
// caller's own client. One flat function handles both methods (single path, so
// no config.method discrimination needed). Authz via requirePortfolio
// (enable-gate 412 + L1 Owner bypass); view to read, edit to save/publish.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePortfolio } from './_portfolio-authz';

export const config = { path: '/api/brand-site' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requirePortfolio(req, ['portfolio.business.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const rows = (await sql`
      SELECT sections, published FROM public.brand_site_config
      WHERE client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ sections: Record<string, unknown>; published: boolean }>;
    const row = rows[0];
    return jsonOk({ sections: row?.sections ?? {}, published: row?.published ?? false });
  }

  if (req.method === 'PUT') {
    const a = await requirePortfolio(req, ['portfolio.business.edit']);
    if (!a.ok) return a.res;
    let body: { sections?: unknown; published?: unknown };
    try { body = (await req.json()) as { sections?: unknown; published?: unknown }; }
    catch { return jsonError(400, 'invalid_body'); }
    const sections = body.sections && typeof body.sections === 'object' ? body.sections : {};
    const published = body.published === true;
    const sql = db();
    await sql`
      INSERT INTO public.brand_site_config (client_id, sections, published, updated_at)
      VALUES (${a.ctx.clientId}::uuid, ${JSON.stringify(sections)}::jsonb, ${published}, now())
      ON CONFLICT (client_id) DO UPDATE
        SET sections = EXCLUDED.sections, published = EXCLUDED.published, updated_at = now()
    `;
    return jsonOk({ sections, published });
  }

  return jsonError(405, 'method_not_allowed');
}
