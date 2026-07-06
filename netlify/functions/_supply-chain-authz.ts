// Supply-chain authorization. Tenant-wide (client_id) — the backing tables carry
// no user_node scoping, so there is no subtree resolver (unlike analytics).
//
// Two layers, in order (Iron Rule 2):
//   1. Enable-gate — the supply-chain MODULE must be reachable from an enabled
//      product for this Client (412 supply_chain_module_not_enabled otherwise).
//   2. Permission — the single bucket key supply-chain.products.view, with
//      admin + L1 Owner bypass.
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import {
  requireAdmin, requireBucketUser, getLevelMatrix, UnauthorizedError,
} from './_shared/permissions';
import { getProduct } from '../../src/modules/registry/products';

const REQUIRED_KEY = 'supply-chain.products.view';

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
