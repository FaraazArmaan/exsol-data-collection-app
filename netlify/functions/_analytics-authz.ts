// Analytics authorization + scope resolver.
//
// Shared by every analytics-* endpoint. Two responsibilities:
//   1. Authenticate (admin OR bucket-user) and compute which analytics data
//      buckets the caller is entitled to (`analytics.<bucket>.view`).
//   2. Resolve the subtree scope: root callers (admin or L1 Owner) see the
//      whole tenant (scopeNodes = null); L2+ callers are scoped to their own
//      subtree, or to a descendant node passed via ?node= (validated).
//
// We do NOT route through requirePermission(key) because a caller may hold one
// analytics bucket but not another — the overview endpoint must still serve the
// buckets they do hold. So we authenticate directly and read the matrix here.

import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { subtreeOf } from './_shared/subtree';
import {
  requireAdmin, requireBucketUser, getLevelMatrix, UnauthorizedError,
} from './_shared/permissions';

export type Bucket = 'business' | 'customers' | 'employees' | 'products';
const ALL_BUCKETS: Bucket[] = ['business', 'customers', 'employees', 'products'];

export interface AnalyticsAccess {
  clientId: string;
  userNodeId: string | null;   // null for admin sessions
  isRootScope: boolean;        // admin OR level_number === 1
  scopeNodes: string[] | null; // null when root scope (no node filter); else subtree ids
  buckets: Set<Bucket>;        // which analytics.<bucket>.view the caller holds
}

export async function resolveAnalyticsAccess(
  req: Request,
  requiredBucket?: Bucket,
): Promise<{ ok: true; access: AnalyticsAccess } | { ok: false; res: Response }> {
  // 1. Admin session → full tenant, all buckets. Admins act on a client via ?client=.
  try {
    await requireAdmin(req);
    const clientId = new URL(req.url).searchParams.get('client');
    if (!clientId) return { ok: false, res: jsonError(400, 'missing_client') };
    return {
      ok: true,
      access: {
        clientId, userNodeId: null, isRootScope: true, scopeNodes: null,
        buckets: new Set(ALL_BUCKETS),
      },
    };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    // not an admin session — fall through to bucket-user
  }

  // 2. Bucket-user session.
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

  const levelNumber = nodeRows[0]!.level_number ?? 1; // legacy null level → Primary
  const clientId = nodeRows[0]!.client_id;
  const isRoot = levelNumber === 1;

  // Entitled buckets: owner = all; else read from the level matrix.
  let buckets: Set<Bucket>;
  if (isRoot) {
    buckets = new Set(ALL_BUCKETS);
  } else {
    const matrix = await getLevelMatrix(clientId, levelNumber);
    buckets = new Set(ALL_BUCKETS.filter((b) => matrix[`analytics.${b}.view`]));
  }

  if (requiredBucket && !buckets.has(requiredBucket)) {
    return { ok: false, res: jsonError(403, 'forbidden') };
  }

  // Scope. Root → no node filter. Else subtree of (?node within own subtree) or self.
  let scopeNodes: string[] | null = null;
  if (!isRoot) {
    const ownSubtree = await subtreeOf(sql, credential.user_node_id);
    const requested = new URL(req.url).searchParams.get('node');
    if (requested && requested !== credential.user_node_id) {
      if (!ownSubtree.includes(requested)) {
        return { ok: false, res: jsonError(403, 'forbidden_subtree') };
      }
      scopeNodes = await subtreeOf(sql, requested);
    } else {
      scopeNodes = ownSubtree;
    }
  }

  return {
    ok: true,
    access: {
      clientId, userNodeId: credential.user_node_id, isRootScope: isRoot, scopeNodes, buckets,
    },
  };
}
