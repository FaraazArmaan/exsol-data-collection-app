// Marketing authorization. Mirrors _crm-authz.requireCrm.
//
// Two layers, in order:
//   1. Enable-gate — the marketing MODULE must be reachable from an enabled
//      product for this Client (412 marketing_module_not_enabled otherwise).
//   2. Permission — the caller must hold the explicit marketing.<bucket>.<verb>
//      key, EXCEPT L1 (Primary/Owner), who is treated as all-on.
//
// Non-Owners (L2+) still require explicit grants. For L1 we return the FULL
// marketing.* set in ctx.perms so downstream verb checks treat the Owner as
// fully privileged, not merely able to pass `required`.
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '@registry/products';

export interface MarketingAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

const ALL_MARKETING_PERMS = [
  'marketing.customers.view', 'marketing.customers.create',
  'marketing.customers.edit', 'marketing.customers.delete',
] as const;

export async function requireMarketing(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: MarketingAuthCtx } | { ok: false; res: Response }> {
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
  // Resolve the caller's level + permission set. LEFT JOIN so a node whose
  // level has no client_levels row still resolves its level_number.
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

  // Module gate: is 'marketing' brought in by any enabled product for this client?
  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('marketing')) {
    return { ok: false, res: jsonError(412, 'marketing_module_not_enabled') };
  }

  // L1 (Primary/Owner) is all-on. The enable-gate above is the product-level
  // check; the Owner needs no surface-level grant.
  if (levelNumber === 1) {
    return {
      ok: true,
      ctx: {
        userNodeId: credential.user_node_id,
        clientId: claims.client_id,
        perms: new Set(ALL_MARKETING_PERMS),
      },
    };
  }

  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
