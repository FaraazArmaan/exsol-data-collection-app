import { db } from './db';
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

async function getLevelMatrix(clientId: string, levelNumber: number): Promise<Record<string, true>> {
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
