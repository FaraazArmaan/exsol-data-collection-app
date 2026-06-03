import { db } from './db';
import { jsonError } from './http';
import {
  readCookieToken, verifySession, type SessionClaims,
  readBuCookieToken, verifyBucketUserSession, type BucketUserClaims,
} from './session';

export interface AdminRecord {
  id: string;
  email: string;
  display_name: string;
  is_bootstrap: boolean;
}

export interface UserNodeCredentialRecord {
  id: string;
  client_id: string;
  user_node_id: string;
  email: string;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
}

export class UnauthorizedError extends Error {
  constructor(public readonly reason: string) { super(reason); }
}

export async function requireAdmin(req: Request): Promise<{ admin: AdminRecord; claims: SessionClaims }> {
  const token = readCookieToken(req);
  if (!token) throw new UnauthorizedError('no_cookie');
  let claims: SessionClaims;
  try {
    claims = await verifySession(token);
  } catch {
    throw new UnauthorizedError('invalid_token');
  }
  const sql = db();
  const rows = (await sql`
    SELECT id, email, display_name, is_bootstrap
    FROM public.admins
    WHERE id = ${claims.sub}
    LIMIT 1
  `) as AdminRecord[];
  const admin = rows[0];
  if (!admin) throw new UnauthorizedError('admin_not_found');
  return { admin, claims };
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
  } catch {
    throw new UnauthorizedError('invalid_token');
  }
  const sql = db();
  const rows = (await sql`
    SELECT id, client_id, user_node_id, email,
           must_change_password, last_login_at, created_at
    FROM public.user_node_credentials
    WHERE user_node_id = ${claims.sub}::uuid
      AND client_id = ${claims.client_id}::uuid
    LIMIT 1
  `) as UserNodeCredentialRecord[];
  const credential = rows[0];
  if (!credential) throw new UnauthorizedError('credential_not_found');
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
  admin: { id: string; email: string };
}

export interface BucketUserSession {
  kind: 'bucket_user';
  user_node_id: string;
  client_id: string;
  level_number: number;
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
  // Try admin session first.
  try {
    const a = await requireAdmin(req);
    return { kind: 'admin', admin: { id: a.admin.id, email: a.admin.email } };
  } catch (e) {
    if (!(e instanceof UnauthorizedError)) throw e;
    // Not an admin session — fall through.
  }

  // Try bucket-user session.
  const buToken = readBuCookieToken(req);
  if (!buToken) throw new UnauthorizedError('no_session');

  let claims: BucketUserClaims;
  try {
    claims = await verifyBucketUserSession(buToken);
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
    return { kind: 'bucket_user', user_node_id: claims.sub, client_id: clientId, level_number: 1 };
  }

  const matrix = await getLevelMatrix(clientId, levelNumber);
  if (!matrix[key]) throw new ForbiddenError(key);
  return { kind: 'bucket_user', user_node_id: claims.sub, client_id: clientId, level_number: levelNumber };
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
    if (e instanceof ForbiddenError) return jsonError(403, 'forbidden', { key: e.key });
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
