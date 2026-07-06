// Data Collection authorization. Mirrors _procurement-authz / _inventory-authz.
//
// Two layers, in order (Iron Rule 2):
//   1. Enable-gate — the data-collection MODULE must be reachable from an enabled
//      product for this Client (412 data_collection_module_not_enabled otherwise).
//   2. Permission — the caller must hold the explicit data-collection.products.<verb>
//      key, EXCEPT L1 (Primary/Owner), who is treated as all-on.
// Gates the authed "generate onboarding link" endpoint. The public /onboard/:token
// import is token-scoped and does NOT use this (the token is the authorization).
import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { getProduct } from '../../src/modules/registry/products';

export interface DataCollectionAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

export const ALL_DATA_COLLECTION_PERMS = [
  'data-collection.products.view', 'data-collection.products.create',
  'data-collection.products.edit', 'data-collection.products.delete',
] as const;

export async function requireDataCollection(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: DataCollectionAuthCtx } | { ok: false; res: Response }> {
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

  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const modules = new Set<string>();
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product) for (const ref of product.modules) modules.add(ref.module);
  }
  if (!modules.has('data-collection')) {
    return { ok: false, res: jsonError(412, 'data_collection_module_not_enabled') };
  }

  if (levelNumber === 1) {
    return {
      ok: true,
      ctx: {
        userNodeId: credential.user_node_id,
        clientId: claims.client_id,
        perms: new Set(ALL_DATA_COLLECTION_PERMS),
      },
    };
  }

  for (const r of required) {
    if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
  }
  return { ok: true, ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms } };
}
