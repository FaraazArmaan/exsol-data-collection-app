// Supply-chain authorization. Tenant-wide (client_id) — the backing tables carry
// no user_node scoping, so there is no subtree resolver (unlike analytics).
//
// Two resolvers:
//   resolveSupplyChainAccess — read-only (used by 3 read endpoints); accepts admin sessions.
//   resolveSupplyChainWrite  — write operations; bucket-user only; mirrors _procurement-authz.
//
// Both enforce (Iron Rule 2):
//   1. Enable-gate — the supply-chain MODULE must be reachable from an enabled product (412).
//   2. L1 Owner bypass → full perm set.
//   3. Matrix check → 403 for missing key.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import {
  requireAdmin, requireBucketUser, getLevelMatrix, UnauthorizedError,
} from './_shared/permissions';
import { getProduct } from '../../src/modules/registry/products';

const REQUIRED_KEY = 'supply-chain.products.view';

export const ALL_SUPPLY_CHAIN_PERMS = [
  'supply-chain.products.view',
  'supply-chain.products.create',
  'supply-chain.products.edit',
  'supply-chain.products.delete',
] as const;

export interface SupplyChainWriteAccess {
  userNodeId: string;
  clientId: string;
  perms: ReadonlySet<string>;
}

// Is the 'supply-chain' module brought in by any enabled product for this client?
async function supplyChainEnabled(clientId: string): Promise<boolean> {
  const sql = db();
  const enabled = (await sql`
    SELECT product_key FROM public.client_enabled_products WHERE client_id = ${clientId}::uuid
  `) as Array<{ product_key: string }>;
  for (const e of enabled) {
    const product = getProduct(e.product_key);
    if (product && product.modules.some((ref) => ref.module === 'supply-chain')) return true;
  }
  return false;
}

export interface SupplyChainAccess {
  clientId: string;
}

export async function resolveSupplyChainAccess(
  req: Request,
): Promise<{ ok: true; access: SupplyChainAccess } | { ok: false; res: Response }> {
  // 1. Admin → full tenant. Admins act on a client via ?client=.
  try {
    await requireAdmin(req);
    const clientId = new URL(req.url).searchParams.get('client');
    if (!clientId) return { ok: false, res: jsonError(400, 'missing_client') };
    if (!(await supplyChainEnabled(clientId))) {
      return { ok: false, res: jsonError(412, 'supply_chain_module_not_enabled') };
    }
    return { ok: true, access: { clientId } };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    // not admin — fall through
  }

  // 2. Bucket-user.
  let credential: { user_node_id: string; client_id: string };
  try {
    const r = await requireBucketUser(req);
    credential = r.credential;
  } catch (e) {
    if (e instanceof UnauthorizedError) return { ok: false, res: jsonError(401, 'unauthorized') };
    throw e;
  }

  const sql = db();
  const nodeRows = (await sql`
    SELECT level_number, client_id FROM public.user_nodes
    WHERE id = ${credential.user_node_id}::uuid LIMIT 1
  `) as Array<{ level_number: number | null; client_id: string }>;
  if (nodeRows.length === 0) return { ok: false, res: jsonError(401, 'unauthorized') };

  const levelNumber = nodeRows[0]!.level_number ?? 1; // legacy null level → Primary/Owner
  const clientId = nodeRows[0]!.client_id;
  const isOwner = levelNumber === 1;

  // Enable-gate FIRST (Iron Rule 2): a client without the supply-chain product
  // 412s before the Owner bypass or the permission check is reached.
  if (!(await supplyChainEnabled(clientId))) {
    return { ok: false, res: jsonError(412, 'supply_chain_module_not_enabled') };
  }

  if (!isOwner) {
    const matrix = await getLevelMatrix(clientId, levelNumber);
    if (!matrix[REQUIRED_KEY]) return { ok: false, res: jsonError(403, 'forbidden') };
  }

  return { ok: true, access: { clientId } };
}

// Write resolver — mirrors _procurement-authz; bucket-user only (no admin shortcut).
export async function resolveSupplyChainWrite(
  req: Request,
  requiredKey: string,
): Promise<{ ok: true; access: SupplyChainWriteAccess } | { ok: false; res: Response }> {
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
    Object.entries(permRows[0]?.permissions ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k),
  );

  // Enable-gate FIRST (Iron Rule 2).
  if (!(await supplyChainEnabled(claims.client_id))) {
    return { ok: false, res: jsonError(412, 'supply_chain_module_not_enabled') };
  }

  // L1 Owner bypass.
  if (levelNumber === 1) {
    return {
      ok: true,
      access: {
        userNodeId: credential.user_node_id,
        clientId: claims.client_id,
        perms: new Set(ALL_SUPPLY_CHAIN_PERMS),
      },
    };
  }

  if (!perms.has(requiredKey)) {
    return { ok: false, res: jsonError(403, 'missing_permission', { required: requiredKey }) };
  }
  return {
    ok: true,
    access: { userNodeId: credential.user_node_id, clientId: claims.client_id, perms },
  };
}
