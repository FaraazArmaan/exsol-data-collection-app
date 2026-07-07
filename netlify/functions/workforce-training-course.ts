// /api/workforce/training-course/:id
//   PATCH  → edit course (workforce.employees.edit)
//   DELETE → delete course (cascades to completions) (workforce.employees.delete)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWorkforce } from './_workforce-authz';

export const config = { path: '/api/workforce/training-course/:id' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/\/training-course\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

interface PatchCourseBody {
  name?: unknown;
  description?: unknown;
  is_required?: unknown;
  expiry_days?: unknown;
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.edit']);
  if (!a.ok) return a.res;

  let body: PatchCourseBody;
  try {
    body = (await req.json()) as PatchCourseBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }

  const sql = db();

  const existing = (await sql`
    SELECT id, name, description, is_required, expiry_days
    FROM public.training_courses
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; name: string; description: string | null; is_required: boolean; expiry_days: number | null }>;
  if (existing.length === 0) return jsonError(404, 'course_not_found');

  const cur = existing[0]!;

  const name =
    typeof body.name === 'string' ? body.name.trim() || cur.name : cur.name;
  const description =
    body.description !== undefined
      ? (typeof body.description === 'string' ? body.description.trim() || null : null)
      : cur.description;
  const isRequired =
    typeof body.is_required === 'boolean' ? body.is_required : cur.is_required;

  let expiryDays: number | null = cur.expiry_days;
  if (body.expiry_days !== undefined) {
    if (body.expiry_days === null) {
      expiryDays = null;
    } else {
      const ed = Number(body.expiry_days);
      if (!Number.isInteger(ed) || ed <= 0) return jsonError(400, 'expiry_days_must_be_positive_integer');
      expiryDays = ed;
    }
  }

  let rows: Array<Record<string, unknown>>;
  if (expiryDays !== null) {
    rows = (await sql`
      UPDATE public.training_courses
      SET name        = ${name}::text,
          description = ${description}::text,
          is_required = ${isRequired},
          expiry_days = ${expiryDays},
          updated_at  = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, description, is_required, expiry_days, created_at
    `) as Array<Record<string, unknown>>;
  } else {
    rows = (await sql`
      UPDATE public.training_courses
      SET name        = ${name}::text,
          description = ${description}::text,
          is_required = ${isRequired},
          expiry_days = NULL,
          updated_at  = now()
      WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
      RETURNING id, name, description, is_required, expiry_days, created_at
    `) as Array<Record<string, unknown>>;
  }

  if (rows.length === 0) return jsonError(404, 'course_not_found');
  return jsonOk({ course: rows[0] });
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const a = await requireWorkforce(req, ['workforce.employees.delete']);
  if (!a.ok) return a.res;

  const sql = db();

  const existing = (await sql`
    SELECT id FROM public.training_courses
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string }>;
  if (existing.length === 0) return jsonError(404, 'course_not_found');

  await sql`
    DELETE FROM public.training_courses
    WHERE id = ${id}::uuid AND client_id = ${a.ctx.clientId}::uuid
  `;
  return new Response(null, { status: 204 });
}

export default async function handler(req: Request): Promise<Response> {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');
  if (req.method === 'PATCH') return handlePatch(req, id);
  if (req.method === 'DELETE') return handleDelete(req, id);
  return jsonError(405, 'method_not_allowed');
}
