// Shared module-authz factory — the single implementation of iron rule 2's
// gate order: 401 session → 412 enable-gate → L1 Owner bypass → 403 matrix.
// The ordering is structural here: per-module files can no longer get it
// wrong by hand-copying the skeleton.
//
// Per-module `_<key>-authz.ts` files are THIN WRAPPERS over this factory —
// the file-per-module seam is deliberate and load-bearing (the generated
// reference docs attribute gates per file; module terminals own their file).
// Do NOT collapse the wrappers into one registry.
//
// NOT covered by this factory (different semantics — do not force them in):
//   _pos-authz.ts          — gates on PRODUCT keys directly ('products'+'pos'
//                            in client_enabled_products), not the
//                            product→module expansion used here
//   _analytics-authz.ts    — dual admin/bucket-user paths + subtree scoping
//   _supply-chain-authz.ts — two-tier read/write resolution
import { jsonError } from './http';
import { requireBucketUser, UnauthorizedError } from './permissions';
import { db } from './db';
import { getProduct } from '@registry/products';

export interface ModuleAuthCtx {
  userNodeId: string;
  clientId: string;
  /** Resolved level; 1 for Owners (legacy null levels coerce to 1). */
  levelNumber: number;
  perms: ReadonlySet<string>;
}

export type ModuleAuthResult =
  | { ok: true; ctx: ModuleAuthCtx }
  | { ok: false; res: Response };

export interface ModuleAuthzConfig {
  /** Module key(s) satisfying the enable-gate — ANY reachable from an enabled product passes. */
  moduleKeys: readonly string[];
  /** 412 code, e.g. 'finance_module_not_enabled' — kept per-module for wire stability. */
  notEnabledCode: string;
  /** FULL perm set handed to L1 Owners (iron rule 2). */
  allPerms: readonly string[];
}

export function makeModuleAuthz(cfg: ModuleAuthzConfig) {
  return async function requireModule(
    req: Request,
    required: readonly string[],
  ): Promise<ModuleAuthResult> {
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

    // Enable-gate FIRST — before the Owner bypass. Is any of cfg.moduleKeys
    // brought in by an enabled product for this client?
    const enabled = (await sql`
      SELECT product_key FROM public.client_enabled_products WHERE client_id = ${claims.client_id}::uuid
    `) as Array<{ product_key: string }>;
    const modules = new Set<string>();
    for (const e of enabled) {
      const product = getProduct(e.product_key);
      if (product) for (const ref of product.modules) modules.add(ref.module);
    }
    if (!cfg.moduleKeys.some((k) => modules.has(k))) {
      return { ok: false, res: jsonError(412, cfg.notEnabledCode) };
    }

    // L1 (Primary/Owner) is all-on — hand back the FULL module perm set so
    // downstream verb checks treat the Owner as fully privileged. A strict
    // matrix-only check would blank the Owner's UI (iron rule 2).
    if (levelNumber === 1) {
      return {
        ok: true,
        ctx: {
          userNodeId: credential.user_node_id,
          clientId: claims.client_id,
          levelNumber: 1,
          perms: new Set(cfg.allPerms),
        },
      };
    }

    for (const r of required) {
      if (!perms.has(r)) return { ok: false, res: jsonError(403, 'missing_permission', { required: r }) };
    }
    return {
      ok: true,
      ctx: { userNodeId: credential.user_node_id, clientId: claims.client_id, levelNumber, perms },
    };
  };
}
