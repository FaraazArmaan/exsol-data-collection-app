// Workforce + Project Service authorization.
// Covers both the 'workforce' module (staff/shifts) and the 'project-service' module
// (projects + assignments) — both ship in the same 'workforce' Product.
//
// Two layers, in order (Iron Rule 2):
//   1. Enable-gate — the workforce Product must be enabled for this Client.
//   2. Permission — the caller must hold the explicit key, EXCEPT L1 (Primary/Owner)
//      who is treated as all-on. For L1 we return the FULL permission set so
//      downstream verb checks treat the Owner as fully privileged.
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '../../src/modules/registry/products';

export interface WorkforceAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

export const ALL_WORKFORCE_PERMS = [
  'workforce.employees.view', 'workforce.employees.create',
  'workforce.employees.edit', 'workforce.employees.delete',
  'project-service.business.view', 'project-service.business.create',
  'project-service.business.edit', 'project-service.business.delete',
  'project-service.customers.view',
] as const;

export async function requireWorkforce(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: WorkforceAuthCtx } | { ok: false; res: Response }> {
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
  const levelNumber = permRows[0]?.level_number ?? 1;
  const perms = new Set(
    Object.entries(permRows[0]?.permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k),
  );

  // Module gate: 'workforce' product must be enabled for this client.
  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('workforce') && !modules.has('project-service')) {
    return { ok: false, res: jsonError(412, 'workforce_module_not_enabled') };
  }

  // L1 (Primary/Owner) is all-on.
  if (levelNumber === 1) {
    return {
      ok: true,
      ctx: {
        userNodeId: credential.user_node_id,
        clientId: claims.client_id,
        perms: new Set(ALL_WORKFORCE_PERMS),
      },
    };
  }

  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
