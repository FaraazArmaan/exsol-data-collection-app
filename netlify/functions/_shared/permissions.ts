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

export interface BucketUserCredentialRecord {
  id: string;
  client_id: string;
  role_key: string;
  bucket_user_id: string;
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
  credential: BucketUserCredentialRecord;
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
    SELECT id, client_id, role_key, bucket_user_id, email,
           must_change_password, last_login_at, created_at
    FROM public.bucket_user_credentials
    WHERE bucket_user_id = ${claims.sub}
      AND client_id = ${claims.client_id}
      AND role_key = ${claims.role_key}
    LIMIT 1
  `) as BucketUserCredentialRecord[];
  const credential = rows[0];
  if (!credential) throw new UnauthorizedError('credential_not_found');
  return { credential, claims };
}
