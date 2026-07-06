// POS authorization helper.
//
// Two layers, in order:
//   1. Enable-gate — both `products` and `pos` must be enabled for the Client
//      (412 otherwise). This is the product-level access check.
//   2. Permission — the caller must hold the explicit `pos.<action>` key in
//      their level's permissions JSONB, EXCEPT L1 (Primary/Owner), who is
//      treated as all-on. This matches `requirePermission` in
//      _shared/permissions.ts and every other gate in the app, which bypass
//      the stored matrix for L1. The "POS not configured yet" concern that
//      once justified withholding the L1 bypass is already covered by the
//      enable-gate (a pos-disabled Client 412s before the bypass is reached).
//
// Non-Owners (L2+) still require explicit grants. For L1 we return the FULL
// pos.* set in ctx.perms so downstream viewAll scoping and FSM transitions
// treat the Owner as fully privileged, not merely able to pass `required`.
//
// Returns either an authorized context or a Response ready to ship.

import { jsonError } from './_shared/http';
import { requireBucketUser, UnauthorizedError } from './_shared/permissions';
import { db } from './_shared/db';
import { POS_ACTIONS } from '@registry/types';

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

  // Resolve the caller's level + permission set. LEFT JOIN so a node whose
  // level has no client_levels row still resolves its level_number (and lands
  // with an empty matrix → 403 below, unless it's L1).
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

  // L1 (Primary/Owner) is all-on, consistent with requirePermission and every
  // other gate in the app. The enable-gate above is the product-level access
  // check; the Owner needs no surface-level grant. We hand back the FULL pos.*
  // set so downstream viewAll scoping and FSM transitions treat them as fully
  // privileged — not just able to pass `required`.
  if (levelNumber === 1) {
    const ownerPerms = new Set(POS_ACTIONS.map((a) => `pos.${a}`));
    return {
      ok: true,
      ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms: ownerPerms },
    };
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
