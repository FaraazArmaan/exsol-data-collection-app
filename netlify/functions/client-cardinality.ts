import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { AdminCapabilityError, requireAdminCapability, UnauthorizedError } from './_shared/permissions';
import { jsonError, jsonOk } from './_shared/http';
import { assertUuid } from './_shared/identifier';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';

const RuleSchema = z.object({
  parent_role_id: z.string().uuid().nullable(),
  child_role_id: z.string().uuid(),
  max_children: z.number().int().min(0),
});

const PutBody = z.object({
  rules: z.array(RuleSchema),
});

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'PUT') return jsonError(405, 'method_not_allowed');
  const csrf = rejectCrossSiteMutation(req);
  if (csrf) return csrf;
  let actor;
  try { actor = await requireAdminCapability(req, 'permissions.manage'); } catch (e) {
    if (e instanceof AdminCapabilityError) return jsonError(403, 'admin_role_forbidden', { capability: e.capability });
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw e;
  }

  const clientId = new URL(req.url).searchParams.get('client');
  if (!clientId) return jsonError(400, 'validation_failed', 'client required');
  try { assertUuid(clientId, 'client'); } catch { return jsonError(400, 'validation_failed', 'client must be uuid'); }

  const parsed = PutBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());

  const sql = db();

  // Verify client exists.
  const cExists = (await sql`SELECT 1 FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1`) as unknown[];
  if (cExists.length === 0) return jsonError(404, 'client_not_found');

  // Wipe + insert in a single transaction using sql.transaction([...queries]).
  const queries: unknown[] = [sql`DELETE FROM public.client_cardinality_rules WHERE client_id = ${clientId}::uuid`];
  for (const r of parsed.data.rules) {
    queries.push(sql`
      INSERT INTO public.client_cardinality_rules (client_id, parent_role_id, child_role_id, max_children)
      VALUES (${clientId}::uuid, ${r.parent_role_id}::uuid, ${r.child_role_id}::uuid, ${r.max_children})
    `);
  }
  try {
    await sql.transaction(queries as never);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23503') return jsonError(400, 'role_not_found');
    if (code === '23505') return jsonError(400, 'duplicate_rule');
    throw e;
  }
  await logAudit(sql, {
    session: { kind: 'admin', admin: { id: actor.admin.id, email: '' } },
    op: 'cardinality.replaced',
    clientId,
    targetType: 'client',
    targetId: clientId,
    detail: { rules_count: parsed.data.rules.length },
  });
  return jsonOk({ ok: true });
};
