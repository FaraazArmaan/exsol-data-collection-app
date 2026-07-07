// HR authorization. Mirrors _finance-authz / _inventory-authz.
//
// Two layers, in order (iron rule 2):
//   1. enable-gate — the HR module must be reachable from an enabled product for
//      this client, else 412 hr_module_not_enabled.
//   2. permission — the caller holds the explicit hr.employees.<verb> key, EXCEPT
//      L1 (Primary/Owner) who is treated as all-on (full hr.* set in ctx.perms).
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '@registry/products';
import { ALL_HR_PERMS } from '../../src/modules/hr/shared/permissions';

export interface HrAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

export async function requireHr(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: HrAuthCtx } | { ok: false; res: Response }> {
  let credential: { user_node_id: string };
  let claims: { client_id: string };
  try {
    const r = await requireBucketUser(req);
    credential = r.credential;
    claims = r.claims;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, res: jsonError(401, 'unauthorized') };
    throw e;
  }

  const sql = db();
  const permRows = (await sql`
    SELECT un.level_number, cl.permissions
    FROM public.user_nodes un
    LEFT JOIN public.client_levels cl
      ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    WHERE un.id = ${credential.user_node_id}::uuid
    LIMIT 1
  `) as Array<{ level_number: number | null; permissions: Record<string, boolean> | null }>;
  const levelNumber = permRows[0]?.level_number ?? 1; // legacy null level → Primary
  const perms = new Set(
    Object.entries(permRows[0]?.permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k),
  );

  // enable-gate: is 'hr' brought in by any enabled product for this client?
  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('hr')) {
    return { ok: false, res: jsonError(412, 'hr_module_not_enabled') };
  }

  // L1 Owner is all-on — hand back the full hr.* set.
  if (levelNumber === 1) {
    return {
      ok: true,
      ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms: new Set(ALL_HR_PERMS) },
    };
  }

  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
