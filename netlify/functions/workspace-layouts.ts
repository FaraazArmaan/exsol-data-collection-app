import { z } from 'zod';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';

export const config = { path: '/api/workspace-layouts' };

const Namespace = z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/).max(120);
const ItemId = z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)*$/).max(120);
const Layout = z.object({
  version: z.literal(1),
  tabs: z.array(ItemId).max(40).optional(),
  blocks: z.array(z.object({ id: ItemId, size: z.enum(['compact', 'standard', 'wide']) }).strict()).max(40).optional(),
}).strict();
const Mutation = z.object({ scope: z.enum(['personal', 'default']), layout: Layout.nullable() }).strict();

type LayoutValue = z.infer<typeof Layout>;
type NodeRow = { level_number: number | null };
type LayoutRow = { layout: LayoutValue };

async function actorFor(req: Request) {
  const { claims } = await requireBucketUser(req);
  const sql = db();
  const rows = (await sql`
    SELECT level_number
    FROM public.user_nodes
    WHERE id = ${claims.sub}::uuid AND client_id = ${claims.client_id}::uuid
    LIMIT 1
  `) as NodeRow[];
  if (!rows[0]) throw new UnauthorizedError('user_node_not_found');
  return { claims, sql, isOwner: rows[0].level_number === 1, levelNumber: rows[0].level_number ?? 2 };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'PUT') return jsonError(405, 'method_not_allowed');
  if (req.method === 'PUT') {
    const csrf = rejectCrossSiteMutation(req);
    if (csrf) return csrf;
  }

  let actor: Awaited<ReturnType<typeof actorFor>>;
  try { actor = await actorFor(req); }
  catch (error) {
    if (error instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    throw error;
  }
  const namespace = Namespace.safeParse(new URL(req.url).searchParams.get('namespace'));
  if (!namespace.success) return jsonError(400, 'invalid_namespace');
  const { claims, sql } = actor;

  if (req.method === 'GET') {
    const [personal, workspaceDefault] = await Promise.all([
      sql`SELECT layout FROM public.user_workspace_layout_preferences WHERE client_id = ${claims.client_id}::uuid AND user_node_id = ${claims.sub}::uuid AND namespace = ${namespace.data} LIMIT 1`,
      sql`SELECT layout FROM public.workspace_layout_defaults WHERE client_id = ${claims.client_id}::uuid AND namespace = ${namespace.data} LIMIT 1`,
    ]) as [LayoutRow[], LayoutRow[]];
    return jsonOk({
      personal_layout: personal[0]?.layout ?? null,
      default_layout: workspaceDefault[0]?.layout ?? null,
      is_owner: actor.isOwner,
    });
  }

  const body = Mutation.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonError(400, 'validation_failed');
  if (body.data.scope === 'default' && !actor.isOwner) return jsonError(403, 'owner_required');

  if (body.data.layout === null) {
    if (body.data.scope === 'personal') {
      await sql`DELETE FROM public.user_workspace_layout_preferences WHERE client_id = ${claims.client_id}::uuid AND user_node_id = ${claims.sub}::uuid AND namespace = ${namespace.data}`;
    } else {
      await sql`DELETE FROM public.workspace_layout_defaults WHERE client_id = ${claims.client_id}::uuid AND namespace = ${namespace.data}`;
    }
  } else if (body.data.scope === 'personal') {
    await sql`
      INSERT INTO public.user_workspace_layout_preferences (client_id, user_node_id, namespace, layout)
      VALUES (${claims.client_id}::uuid, ${claims.sub}::uuid, ${namespace.data}, ${JSON.stringify(body.data.layout)}::jsonb)
      ON CONFLICT (client_id, user_node_id, namespace) DO UPDATE SET layout = EXCLUDED.layout
    `;
  } else {
    await sql`
      INSERT INTO public.workspace_layout_defaults (client_id, namespace, layout, updated_by_user_node_id)
      VALUES (${claims.client_id}::uuid, ${namespace.data}, ${JSON.stringify(body.data.layout)}::jsonb, ${claims.sub}::uuid)
      ON CONFLICT (client_id, namespace) DO UPDATE SET layout = EXCLUDED.layout, updated_by_user_node_id = EXCLUDED.updated_by_user_node_id
    `;
  }
  await logAudit(sql, {
    session: { kind: 'bucket_user', user_node_id: claims.sub, client_id: claims.client_id, level_number: actor.levelNumber },
    op: body.data.scope === 'default' ? 'workspace.layout_default_updated' : 'workspace.layout_personal_updated',
    clientId: claims.client_id,
    targetType: 'workspace_layout',
    targetId: namespace.data,
    detail: { reset: body.data.layout === null },
  });
  return jsonOk({ ok: true });
}
