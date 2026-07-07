// GET  /api/hr/checklist-templates?kind=onboarding|offboarding — list + item counts.
// POST /api/hr/checklist-templates — create { kind, name, items:[{label,description?,action_hint?}] }.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireHr } from './_hr-authz';

export const config = { path: '/api/hr/checklist-templates' };

const KINDS = new Set(['onboarding', 'offboarding']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireHr(req, ['hr.employees.view']);
    if (!a.ok) return a.res;
    const kind = new URL(req.url).searchParams.get('kind') ?? '';
    if (!KINDS.has(kind)) return jsonError(400, 'invalid_kind');
    const sql = db();
    const templates = (await sql`
      SELECT t.id, t.kind, t.name, t.is_default,
             (SELECT count(*) FROM public.hr_checklist_template_items i WHERE i.template_id = t.id)::int AS item_count
      FROM public.hr_checklist_templates t
      WHERE t.client_id = ${a.ctx.clientId}::uuid AND t.kind = ${kind}
      ORDER BY t.is_default DESC, t.created_at
    `) as unknown[];
    return jsonOk({ templates });
  }

  if (req.method === 'POST') {
    const a = await requireHr(req, ['hr.employees.edit']);
    if (!a.ok) return a.res;
    let body: { kind?: unknown; name?: unknown; items?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return jsonError(400, 'invalid_body'); }
    const kind = String(body.kind ?? '');
    const name = String(body.name ?? '').trim();
    const items = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
    if (!KINDS.has(kind)) return jsonError(400, 'invalid_kind');
    if (!name) return jsonError(400, 'name_required');

    const sql = db();
    const t = (await sql`
      INSERT INTO public.hr_checklist_templates (client_id, kind, name)
      VALUES (${a.ctx.clientId}::uuid, ${kind}, ${name}) RETURNING id
    `) as Array<{ id: string }>;
    const tid = t[0]!.id;
    let pos = 0;
    for (const it of items) {
      const label = String(it.label ?? '').trim();
      if (!label) continue;
      await sql`
        INSERT INTO public.hr_checklist_template_items (template_id, position, label, description, action_hint)
        VALUES (${tid}::uuid, ${pos}, ${label},
                ${it.description ? String(it.description) : null},
                ${it.action_hint ? String(it.action_hint) : null})
      `;
      pos++;
    }
    return jsonOk({ id: tid }, { status: 201 });
  }

  return jsonError(405, 'method_not_allowed');
}
