// /api/manufacturing/resources
//   GET  → work centers with daily hours capacity (manufacturing.business.view)
//   POST → create a resource { name, hours_per_day } (manufacturing.business.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireManufacturing } from './_manufacturing-authz';

export const config = { path: '/api/manufacturing/resources', method: ['GET', 'POST'] };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireManufacturing(req, ['manufacturing.business.view']);
    if (!a.ok) return a.res;
    const sql = db();
    const resources = (await sql`
      SELECT id, name, hours_per_day, created_at FROM public.manufacturing_resources
      WHERE client_id = ${a.ctx.clientId}::uuid ORDER BY name ASC
    `) as unknown[];
    return jsonOk({ resources });
  }

  if (req.method === 'POST') {
    const a = await requireManufacturing(req, ['manufacturing.business.create']);
    if (!a.ok) return a.res;
    let body: { name?: unknown; hours_per_day?: unknown };
    try { body = await req.json(); } catch { return jsonError(400, 'invalid_json'); }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const hours = typeof body.hours_per_day === 'number' ? Math.trunc(body.hours_per_day) : NaN;
    if (!name) return jsonError(400, 'name_required');
    if (!Number.isFinite(hours) || hours <= 0) return jsonError(400, 'hours_invalid');

    const sql = db();
    try {
      const rows = (await sql`
        INSERT INTO public.manufacturing_resources (client_id, name, hours_per_day)
        VALUES (${a.ctx.clientId}::uuid, ${name}, ${hours}::int)
        RETURNING id, name, hours_per_day, created_at
      `) as Array<Record<string, unknown>>;
      return jsonOk({ resource: rows[0] }, { status: 201 });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') return jsonError(409, 'name_taken');
      throw e;
    }
  }

  return new Response('Method Not Allowed', { status: 405 });
}
