// /api/workforce/projects
//   GET  → list projects for this client (project-service.business.view)
//   POST { name, customer_id? } → create a project in 'quoted' status
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/projects' };

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const status = url.searchParams.get('status');

  const sql = db();
  const rows = status
    ? (await sql`
        SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
               p.customer_id, c.display_name AS customer_name
        FROM public.projects p
        LEFT JOIN public.crm_customers c ON c.id = p.customer_id
        WHERE p.client_id = ${a.ctx.clientId}::uuid
          AND p.status = ${status}
        ORDER BY p.created_at DESC
      `) as unknown[]
    : (await sql`
        SELECT p.id, p.name, p.status, p.created_at, p.updated_at,
               p.customer_id, c.display_name AS customer_name
        FROM public.projects p
        LEFT JOIN public.crm_customers c ON c.id = p.customer_id
        WHERE p.client_id = ${a.ctx.clientId}::uuid
        ORDER BY p.created_at DESC
      `) as unknown[];
  return jsonOk({ projects: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['project-service.business.create']);
  if (!a.ok) return a.res;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const customerId = typeof body.customer_id === 'string' ? body.customer_id.trim() : null;
  if (!name) return jsonError(400, 'name_required');

  const sql = db();

  // If a customer_id was supplied, verify it belongs to this client.
  if (customerId) {
    const c = (await sql`
      SELECT id FROM public.crm_customers
      WHERE id = ${customerId}::uuid AND client_id = ${a.ctx.clientId}::uuid
      LIMIT 1
    `) as Array<{ id: string }>;
    if (!c.length) return jsonError(404, 'customer_not_found');
  }

  const rows = customerId
    ? (await sql`
        INSERT INTO public.projects (client_id, name, customer_id)
        VALUES (${a.ctx.clientId}::uuid, ${name}, ${customerId}::uuid)
        RETURNING id, name, status, customer_id, created_at, updated_at
      `) as Array<Record<string, unknown>>
    : (await sql`
        INSERT INTO public.projects (client_id, name)
        VALUES (${a.ctx.clientId}::uuid, ${name})
        RETURNING id, name, status, customer_id, created_at, updated_at
      `) as Array<Record<string, unknown>>;
  return jsonOk({ project: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
