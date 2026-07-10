import type { NeonQueryFunction } from '@neondatabase/serverless';
import { db } from './db';
import { jsonError } from './http';
import {
  readCookieToken, verifySession, type SessionClaims,
  readBuCookieToken, verifyBucketUserSession, type BucketUserClaims,
  assertActiveSession,
} from './session';
import { subtreeOf } from './subtree';

type SQL = NeonQueryFunction<false, false>;

export interface AdminRecord {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
  role: AdminRole;
  disabled_at: string | null;
  locked_until: string | null;
}

export type AdminRole = 'owner' | 'support' | 'billing' | 'read_only' | 'security_admin';
export type AdminCapability =
  | 'admin.manage'
  | 'admin.impersonate'
  | 'workspace.export'
  | 'client.delete'
  | 'products.manage'
  | 'permissions.manage';

const ADMIN_CAPABILITIES: Record<AdminCapability, readonly AdminRole[]> = {
  'admin.manage': ['owner', 'security_admin'],
  'admin.impersonate': ['owner', 'support'],
  'workspace.export': ['owner', 'support', 'security_admin'],
  'client.delete': ['owner'],
  'products.manage': ['owner'],
  'permissions.manage': ['owner', 'security_admin'],
};

export interface UserNodeCredentialRecord {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  must_change_password: boolean;
  disabled_at: string | null;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
}

export class UnauthorizedError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

export class AdminCapabilityError extends Error {
  constructor(public readonly capability: AdminCapability) { super(`admin capability required: ${capability}`); }
}

export async function requireAdmin(req: Request): Promise<{ admin: AdminRecord; claims: SessionClaims }> {
  const token = readCookieToken(req);
  if (!token) throw new UnauthorizedError('no_cookie');
  let claims: SessionClaims;
  try {
    claims = await verifySession(token);
    await assertActiveSession({ jti: claims.jti, realm: 'admin', sub: claims.sub });
  } catch {
    throw new UnauthorizedError('invalid_token');
  }
  const sql = db();
  const rows = (await sql`
    SELECT id, email, display_name, is_bootstrap, role, disabled_at, locked_until
    FROM public.admins
    WHERE id = ${claims.sub}
    LIMIT 1
  `) as AdminRecord[];
  const admin = rows[0];
  if (!admin) throw new UnauthorizedError('admin_not_found');
  if (admin.disabled_at) throw new UnauthorizedError('admin_disabled');
  if (admin.locked_until && new Date(admin.locked_until).getTime() > Date.now()) {
    throw new UnauthorizedError('admin_locked');
  }
  return { admin, claims };
}

export function adminHasCapability(
  admin: { role?: AdminRole | null; is_bootstrap?: boolean | null },
  capability: AdminCapability,
): boolean {
  if (admin.is_bootstrap) return true;
  return ADMIN_CAPABILITIES[capability].includes(admin.role ?? 'read_only');
}

export async function requireAdminCapability(
  req: Request,
  capability: AdminCapability,
): Promise<{ admin: AdminRecord; claims: SessionClaims }> {
  const actor = await requireAdmin(req);
  if (!adminHasCapability(actor.admin, capability)) throw new AdminCapabilityError(capability);
  return actor;
}

export async function requireBucketUser(req: Request): Promise<{
  credential: UserNodeCredentialRecord;
  claims: BucketUserClaims;
}> {
  const token = readBuCookieToken(req);
  if (!token) throw new UnauthorizedError('no_cookie');
  let claims: BucketUserClaims;
  try {
    claims = await verifyBucketUserSession(token);
    await assertActiveSession({
      jti: claims.jti,
      realm: 'bucket_user',
      sub: claims.sub,
      client_id: claims.client_id,
    });
  } catch {
    throw new UnauthorizedError('invalid_token');
  }
  const sql = db();
  const rows = (await sql`
    SELECT id, client_id, user_node_id, email,
           must_change_password, disabled_at, locked_until, last_login_at, created_at
    FROM public.user_node_credentials
    WHERE user_node_id = ${claims.sub}::uuid
      AND client_id = ${claims.client_id}::uuid
    LIMIT 1
  `) as UserNodeCredentialRecord[];
  const credential = rows[0];
  if (!credential && claims.impersonated_by_admin) {
    return {
      credential: {
        id: '00000000-0000-0000-0000-000000000000',
        client_id: claims.client_id,
        user_node_id: claims.sub,
        email: claims.email,
        must_change_password: false,
        disabled_at: null,
        locked_until: null,
        last_login_at: null,
        created_at: new Date(0).toISOString(),
      },
      claims,
    };
  }
  if (!credential) throw new UnauthorizedError('credential_not_found');
  if (credential.disabled_at) throw new UnauthorizedError('credential_disabled');
  if (credential.locked_until && new Date(credential.locked_until).getTime() > Date.now()) {
    throw new UnauthorizedError('credential_locked');
  }
  return { credential, claims };
}

// ---------------------------------------------------------------------------
// Permission-matrix middleware
// ---------------------------------------------------------------------------

export class ForbiddenError extends Error {
  constructor(public readonly key: string) { super(`forbidden: ${key}`); }
}

export interface AdminSession {
  kind: 'admin';
  admin: { id: string; email: string; role?: AdminRole; is_bootstrap?: boolean };
}

export interface BucketUserSession {
  kind: 'bucket_user';
  user_node_id: string;
  client_id: string;
  level_number: number;
  impersonated_by_admin?: string;
  impersonation_started_at?: string;
  impersonation_reason?: string;
}

export type AnySession = AdminSession | BucketUserSession;

export async function getLevelMatrix(clientId: string, levelNumber: number): Promise<Record<string, true>> {
  const sql = db();
  const rows = (await sql`
    SELECT permissions FROM public.client_levels
    WHERE client_id = ${clientId}::uuid AND level_number = ${levelNumber}
    LIMIT 1
  `) as { permissions: Record<string, true> | null }[];
  return rows[0]?.permissions ?? {};
}

export async function requirePermission(req: Request, key: string): Promise<AnySession> {
  // Bucket-user session FIRST. Under admin impersonation ("view as client",
  // admin-impersonate.ts) the browser carries BOTH cookies; resolving
  // admin-first turned every authenticateForPermission endpoint into
  // missing_client (400) because the workspace UI never passes ?client=.
  // Workspace scope wins when a valid bu_session exists; an admin who needs
  // cross-client admin scope must not carry one (exit impersonation first).
  // A stale/invalid bu_session falls through to the admin path — but a
  // VALID bucket session lacking `key` stays a 403 (no silent escalation to
  // admin scope just because an admin cookie rides along).
  const buToken = readBuCookieToken(req);
  if (buToken) {
    try {
      return await resolveBucketUserSession(buToken, key);
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) throw e;
      // Stale/invalid bu cookie — fall through to the admin session.
    }
  }

  try {
    const a = await requireAdmin(req);
    return {
      kind: 'admin',
      admin: {
        id: a.admin.id,
        email: a.admin.email,
        role: a.admin.role,
        is_bootstrap: a.admin.is_bootstrap,
      },
    };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
  }

  throw new UnauthorizedError('no_session');
}

async function resolveBucketUserSession(buToken: string, key: string): Promise<BucketUserSession> {
  let claims: BucketUserClaims;
  try {
    claims = await verifyBucketUserSession(buToken);
    await assertActiveSession({
      jti: claims.jti,
      realm: 'bucket_user',
      sub: claims.sub,
      client_id: claims.client_id,
    });
  } catch {
    throw new UnauthorizedError('invalid_token');
  }

  const sql = db();
  // level_number is not in the JWT — fetch from user_nodes.
  const nodeRows = (await sql`
    SELECT level_number, client_id FROM public.user_nodes
    WHERE id = ${claims.sub}::uuid LIMIT 1
  `) as { level_number: number; client_id: string }[];
  if (nodeRows.length === 0) throw new UnauthorizedError('user_node_missing');

  const levelNumber: number = nodeRows[0]!.level_number;
  const clientId: string = nodeRows[0]!.client_id;

  // L1 (Primary) bypasses the matrix check.
  if (levelNumber === 1) {
    return bucketSessionFromClaims(claims, clientId, 1);
  }

  const matrix = await getLevelMatrix(clientId, levelNumber);
  if (!matrix[key]) throw new ForbiddenError(key);
  return bucketSessionFromClaims(claims, clientId, levelNumber);
}

function bucketSessionFromClaims(
  claims: BucketUserClaims,
  clientId: string,
  levelNumber: number,
): BucketUserSession {
  return {
    kind: 'bucket_user',
    user_node_id: claims.sub,
    client_id: clientId,
    level_number: levelNumber,
    impersonated_by_admin: claims.impersonated_by_admin,
    impersonation_started_at: claims.impersonation_started_at,
    impersonation_reason: claims.impersonation_reason,
  };
}

// ---------------------------------------------------------------------------
// Client-scope helpers — pair with requirePermission for endpoints that need
// to know which Client the caller is acting on.
//
// resolveClientId   — for endpoints that take ?client=<uuid> (admin) and
//                     where bucket-user is implicitly scoped to own client.
// authorizeClientScope — for endpoints that lookup a node row by ?id=<uuid>
//                        first; pass node.client_id to verify caller may act.
// ---------------------------------------------------------------------------

export function resolveClientId(
  session: AnySession,
  req: Request,
): { clientId: string } | { error: 'missing_client' | 'forbidden_cross_client' } {
  const param = new URL(req.url).searchParams.get('client');
  if (session.kind === 'admin') {
    if (!param) return { error: 'missing_client' };
    return { clientId: param };
  }
  // bucket_user — JWT-scoped. Reject any explicit ?client= that doesn't match.
  if (param && param !== session.client_id) {
    return { error: 'forbidden_cross_client' };
  }
  return { clientId: session.client_id };
}

export function authorizeClientScope(
  session: AnySession,
  rowClientId: string,
): { ok: true } | { error: 'forbidden_cross_client' } {
  if (session.kind === 'admin') return { ok: true };
  return rowClientId === session.client_id
    ? { ok: true }
    : { error: 'forbidden_cross_client' };
}

/**
 * After authorizeClientScope passes, narrow further to the caller's subtree
 * if they're an L2+ bucket-user. Admin and L1 Owner always pass.
 *
 * Pattern:
 *   const scope = authorizeClientScope(session, node.client_id);
 *   if ('error' in scope) return jsonError(403, scope.error);
 *   const subtree = await authorizeSubtreeScope(sql, session, node.id);
 *   if ('error' in subtree) return jsonError(403, subtree.error);
 */
export async function authorizeSubtreeScope(
  sql: SQL,
  session: AnySession,
  targetNodeId: string,
): Promise<{ ok: true } | { error: 'forbidden_subtree' }> {
  // Admin and L1 bypass.
  if (session.kind === 'admin') return { ok: true };
  if (session.level_number <= 1) return { ok: true };
  // L2+ — fetch subtree and check membership.
  const allowed = await subtreeOf(sql, session.user_node_id);
  return allowed.includes(targetNodeId)
    ? { ok: true }
    : { error: 'forbidden_subtree' };
}

// ---------------------------------------------------------------------------
// HTTP-aware wrappers — collapse the requirePermission + error-mapping and
// resolveClientId + error-mapping boilerplate that endpoints repeat verbatim.
// ---------------------------------------------------------------------------

/**
 * Combine requirePermission + standard HTTP error mapping.
 * Returns either the session OR a Response to send.
 * Endpoint pattern:
 *
 *   const auth = await authenticateForPermission(req, '_platform.users.view');
 *   if (auth instanceof Response) return auth;
 *   const session = auth;
 */
export async function authenticateForPermission(
  req: Request, key: string,
): Promise<AnySession | Response> {
  try {
    return await requirePermission(req, key);
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    if (e instanceof ForbiddenError) return jsonError(403, 'forbidden');
    throw e;
  }
}

export async function authenticateForAdminCapabilityOrOwner(
  req: Request,
  capability: AdminCapability,
): Promise<AnySession | Response> {
  const buToken = readBuCookieToken(req);
  if (buToken) {
    try {
      const session = await resolveBucketUserSession(buToken, '_platform.users.view');
      if (session.level_number === 1) return session;
      return jsonError(403, 'forbidden');
    } catch (e) {
      if (!(e instanceof UnauthorizedError)) throw e;
    }
  }

  try {
    const a = await requireAdminCapability(req, capability);
    return {
      kind: 'admin',
      admin: {
        id: a.admin.id,
        email: a.admin.email,
        role: a.admin.role,
        is_bootstrap: a.admin.is_bootstrap,
      },
    };
  } catch (e) {
    if (e instanceof UnauthorizedError) return jsonError(401, 'unauthorized');
    if (e instanceof AdminCapabilityError) return jsonError(403, 'admin_role_forbidden', { capability: e.capability });
    throw e;
  }
}

/**
 * Combine resolveClientId + standard HTTP error mapping.
 * Returns either { clientId } OR a Response to send.
 * Endpoint pattern:
 *
 *   const scope = resolveClientIdOrRespond(session, req);
 *   if (scope instanceof Response) return scope;
 *   const clientId = scope.clientId;
 */
export function resolveClientIdOrRespond(
  session: AnySession, req: Request,
): { clientId: string } | Response {
  const r = resolveClientId(session, req);
  if ('error' in r) {
    return jsonError(r.error === 'forbidden_cross_client' ? 403 : 400, r.error);
  }
  return r;
}
