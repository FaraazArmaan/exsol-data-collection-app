// GET  /api/hr/checklist-instances?kind= — list instances with progress.
// POST /api/hr/checklist-instances — start one for a subject
//   { kind, subject_user_node_id, template_id? }. Items are copied from the
//   template, or a built-in default set for the kind if no template is given.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireHr } from './_hr-authz';

export const config = { path: '/api/hr/checklist-instances' };

const KINDS = new Set(['onboarding', 'offboarding']);

// Built-in defaults so both flows work before anyone authors a template.
const DEFAULT_ITEMS: Record<string, Array<{ label: string; action_hint?: string }>> = {
  onboarding: [
    { label: 'Send welcome email' },
    { label: 'Create system logins' },
    { label: 'Assign a buddy / mentor' },
    { label: 'Share the employee handbook' },
    { label: 'Set up workstation & equipment' },
    { label: 'Schedule first-week check-in' },
  ],
  offboarding: [
    { label: 'Disable account access', action_hint: 'disable_access' },
    { label: 'Reassign direct reports', action_hint: 'reassign_subtree' },
    { label: 'Collect equipment' },
    { label: 'Revoke building / key access' },
    { label: 'Final payroll & exit interview' },
  ],
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const a = await requireHr(req, ['hr.employees.view']);
    if (!a.ok) return a.res;
    const kind = new URL(req.url).searchParams.get('kind') ?? '';
    if (!KINDS.has(kind)) return jsonError(400, 'invalid_kind');
    const sql = db();
    const instances = (await sql`
      SELECT i.id, i.kind, i.subject_user_node_id, i.subject_name, i.status, i.created_at, i.completed_at,
             (SELECT count(*) FROM public.hr_checklist_instance_items x WHERE x.instance_id = i.id)::int AS total,
             (SELECT count(*) FROM public.hr_checklist_instance_items x WHERE x.instance_id = i.id AND x.done)::int AS done
      FROM public.hr_checklist_instances i
      WHERE i.client_id = ${a.ctx.clientId}::uuid AND i.kind = ${kind}
      ORDER BY (i.status = 'open') DESC, i.created_at DESC
    `) as unknown[];
    return jsonOk({ instances });
  }

  if (req.method === 'POST') {
    const a = await requireHr(req, ['hr.employees.create']);
    if (!a.ok) return a.res;
    let body: { kind?: unknown; subject_user_node_id?: unknown; template_id?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return jsonError(400, 'invalid_body'); }
    const kind = String(body.kind ?? '');
    const subjectId = body.subject_user_node_id ? String(body.subject_user_node_id) : null;
    const templateId = body.template_id ? String(body.template_id) : null;
    if (!KINDS.has(kind)) return jsonError(400, 'invalid_kind');
    if (!subjectId) return jsonError(400, 'subject_required');

    const sql = db();
    // Subject must be a node of THIS client — snapshot the name.
    const subj = (await sql`
      SELECT display_name FROM public.user_nodes
      WHERE id = ${subjectId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ display_name: string }>;
    if (!subj[0]) return jsonError(404, 'subject_not_found');

    // Resolve the item set: template items (if valid + same client) else defaults.
    let items: Array<{ label: string; description: string | null; action_hint: string | null }> = [];
    if (templateId) {
      const tpl = (await sql`
        SELECT 1 FROM public.hr_checklist_templates
        WHERE id = ${templateId}::uuid AND client_id = ${a.ctx.clientId}::uuid AND kind = ${kind} LIMIT 1
      `) as unknown[];
      if (!tpl[0]) return jsonError(404, 'template_not_found');
      items = (await sql`
        SELECT label, description, action_hint FROM public.hr_checklist_template_items
        WHERE template_id = ${templateId}::uuid ORDER BY position
      `) as Array<{ label: string; description: string | null; action_hint: string | null }>;
    }
    if (items.length === 0) {
      items = (DEFAULT_ITEMS[kind] ?? []).map((d) => ({ label: d.label, description: null, action_hint: d.action_hint ?? null }));
    }

    const ins = (await sql`
      INSERT INTO public.hr_checklist_instances
        (client_id, kind, subject_user_node_id, subject_name, template_id, created_by_user_node)
      VALUES (${a.ctx.clientId}::uuid, ${kind}, ${subjectId}::uuid, ${subj[0].display_name},
              ${templateId ? templateId : null}, ${a.ctx.userNodeId}::uuid)
      RETURNING id
    `) as Array<{ id: string }>;
    const iid = ins[0]!.id;
    let pos = 0;
    for (const it of items) {
      await sql`
        INSERT INTO public.hr_checklist_instance_items (instance_id, position, label, description, action_hint)
        VALUES (${iid}::uuid, ${pos}, ${it.label}, ${it.description}, ${it.action_hint})
      `;
      pos++;
    }
    return jsonOk({ id: iid }, { status: 201 });
  }

  return jsonError(405, 'method_not_allowed');
}
