// POS authorization helper.
//
// Unlike `requirePermission` in _shared/permissions.ts, POS does NOT give L1
// Owners a matrix bypass — the POS endpoints (menu, cart, sale) require the
// caller to hold the explicit `pos.<action>` key in their level's permissions
// JSONB. Rationale: the dependency gates (`products` + `pos` enabled) are the
// product-level access check; the permission key is the surface-level check.
// Bypassing the latter for L1 would silently grant POS access to any L1 Owner
// at a Client that has Products enabled but POS not configured yet.
//
// Returns either an authorized context or a Response ready to ship.

import { jsonError } from '../_shared/http';
import { requireBucketUser, UnauthorizedError } from '../_shared/permissions';
import { db } from '../_shared/db';

export interface PosAuthCtx {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

export async function requirePos(
  req: Request,
  required: readonly string[],
): Promise<{ ok: true; ctx: PosAuthCtx } | { ok: false; res: Response }> {
  let credential: { user_node_id: string; client_id: string };
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

  // Resolve permission set from the caller's level row.
  const permRows = (await sql`
    SELECT cl.permissions
    FROM public.user_nodes un
    JOIN public.client_levels cl
      ON cl.client_id = un.client_id AND cl.level_number = un.level_number
    WHERE un.id = ${credential.user_node_id}::uuid
    LIMIT 1
  `) as Array<{ permissions: Record<string, boolean> | null }>;
  const perms = new Set(
    Object.entries(permRows[0]?.permissions ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k),
  );

  // Dependency / enable checks — both `products` and `pos` must be on for this
  // Client. Migration 042 backfills `pos` for every Client that already has
  // `products`, so prod data should always pass once `products` is enabled.
  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products
    WHERE client_id = ${claims.client_id}::uuid
  `) as Array<{ product_key: string }>;
  const enabledSet = new Set(enabled.map((e) => e.product_key));
  if (!enabledSet.has('products')) {
    return { ok: false, res: jsonError(412, 'products_module_required') };
  }
  if (!enabledSet.has('pos')) {
    return { ok: false, res: jsonError(412, 'pos_module_not_enabled') };
  }

  for (const r of required) {
    if (!perms.has(r)) {
      return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
    }
  }
  return {
    ok: true,
    ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms },
  };
}
