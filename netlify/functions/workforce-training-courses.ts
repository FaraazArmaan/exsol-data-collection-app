// /api/workforce/training-courses
//   GET  → list training courses (workforce.employees.view)
//   POST → create course (workforce.employees.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/training-courses' };

interface CreateCourseBody {
  name?: unknown;
  description?: unknown;
  is_required?: unknown;
  expiry_days?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.view']);
  if (!a.ok) return a.res;

  const sql = db();

  const courses = (await sql`
    SELECT id, name, description, is_required, expiry_days, created_at
    FROM public.training_courses
    WHERE client_id = ${a.ctx.clientId}::uuid
    ORDER BY name ASC
  `) as unknown[];

  return jsonOk({ courses });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.create']);
  if (!a.ok) return a.res;

  let body: CreateCourseBody;
  try {
    body = (await req.json()) as CreateCourseBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return jsonError(400, 'name_required');

  const description =
    typeof body.description === 'string' ? body.description.trim() || null : null;

  const isRequired =
    typeof body.is_required === 'boolean' ? body.is_required : false;

  let expiryDays: number | null = null;
  if (body.expiry_days !== undefined && body.expiry_days !== null) {
    const ed = Number(body.expiry_days);
    if (!Number.isInteger(ed) || ed <= 0) return jsonError(400, 'expiry_days_must_be_positive_integer');
    expiryDays = ed;
  }

  const sql = db();

  let rows: Array<Record<string, unknown>>;
  if (expiryDays !== null) {
    rows = (await sql`
      INSERT INTO public.training_courses (client_id, name, description, is_required, expiry_days)
      VALUES (${a.ctx.clientId}::uuid, ${name}::text, ${description}::text, ${isRequired}, ${expiryDays})
      RETURNING id, name, description, is_required, expiry_days, created_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      INSERT INTO public.training_courses (client_id, name, description, is_required)
      VALUES (${a.ctx.clientId}::uuid, ${name}::text, ${description}::text, ${isRequired})
      RETURNING id, name, description, is_required, expiry_days, created_at
    `) as Array<Record<string, unknown>>;
  }

  return jsonOk({ course: rows[0] }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
