import { SignJWT, jwtVerify } from 'jose';
import { randomUUID } from 'node:crypto';
import { db } from './db';
import { env } from './env';

const ALG = 'HS256';
const TTL_SECONDS = 15 * 60;
const REFRESH_THRESHOLD_SECONDS = 10 * 60; // refresh if older than TTL - this
type SessionRealm = 'admin' | 'bucket_user';

export interface SessionClaims {
  sub: string;
  email: string;
  realm: 'admin';
  jti: string;
  iat: number;
  exp: number;
}

interface MintOptions {
  persist?: boolean;
  ip?: string | null;
  userAgent?: string | null;
}

function secret() {
  return new TextEncoder().encode(env().JWT_SIGNING_SECRET);
}

export async function mintSession(input: { sub: string; email: string }, opts: MintOptions = {}): Promise<string> {
  const jti = randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + TTL_SECONDS;
  const token = await new SignJWT({ email: input.email, realm: 'admin' })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.sub)
    .setJti(jti)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(secret());
  if (opts.persist ?? true) {
    await insertSession({
      id: jti,
      realm: 'admin',
      subjectId: input.sub,
      clientId: null,
      email: input.email,
      expiresAt: new Date(expSec * 1000),
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    });
  }
  return token;
}

export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.realm !== 'admin' ||
    typeof payload.jti !== 'string'
  ) {
    throw new Error('invalid claims');
  }
  return payload as unknown as SessionClaims;
}

// NB: callers must run verifySession() first. shouldRefresh() returns true
// for already-expired tokens (exp - now is negative, < threshold), but
// jwtVerify enforces expiry, so an expired token never reaches here in
// practice. Calling shouldRefresh in isolation on an expired claims object
// would do the wrong thing.
export function shouldRefresh(claims: SessionClaims, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return claims.exp - nowSec < REFRESH_THRESHOLD_SECONDS;
}

export function cookieHeader(token: string): string {
  const secure = env().COOKIE_SECURE ? '; Secure' : '';
  return `session=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${TTL_SECONDS}`;
}

export function clearCookieHeader(): string {
  const secure = env().COOKIE_SECURE ? '; Secure' : '';
  return `session=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookieToken(req: Request): string | null {
  return readNamedCookie(req, 'session');
}

// ---------------------------------------------------------------------------
// Bucket-user session — independent from admin. Same signing key, but the
// `kind` claim is enforced on verify so an admin token cannot pose as a
// bucket-user token or vice versa.
// ---------------------------------------------------------------------------

const BU_TTL_SECONDS = 24 * 60 * 60;
const BU_REFRESH_THRESHOLD_SECONDS = 12 * 60 * 60;
const BU_COOKIE = 'bu_session';

export interface BucketUserClaims {
  sub: string;            // user_node_id
  email: string;
  kind: 'bucket_user';
  realm: 'bucket_user';
  client_id: string;
  jti: string;
  iat: number;
  exp: number;
}

export async function mintBucketUserSession(input: {
  sub: string; email: string; client_id: string;
}, opts: MintOptions = {}): Promise<string> {
  const jti = randomUUID();
  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + BU_TTL_SECONDS;
  const token = await new SignJWT({
    email: input.email,
    kind: 'bucket_user',
    realm: 'bucket_user',
    client_id: input.client_id,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.sub)
    .setJti(jti)
    .setIssuedAt(nowSec)
    .setExpirationTime(expSec)
    .sign(secret());
  if (opts.persist ?? true) {
    await insertSession({
      id: jti,
      realm: 'bucket_user',
      subjectId: input.sub,
      clientId: input.client_id,
      email: input.email,
      expiresAt: new Date(expSec * 1000),
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    });
  }
  return token;
}

export async function verifyBucketUserSession(token: string): Promise<BucketUserClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.kind !== 'bucket_user' ||
    payload.realm !== 'bucket_user' ||
    typeof payload.jti !== 'string' ||
    typeof payload.client_id !== 'string'
  ) {
    throw new Error('invalid claims');
  }
  return payload as unknown as BucketUserClaims;
}

export function shouldRefreshBucketUser(claims: BucketUserClaims, nowSec = Math.floor(Date.now() / 1000)): boolean {
  return claims.exp - nowSec < BU_REFRESH_THRESHOLD_SECONDS;
}

export function buCookieHeader(token: string): string {
  const secure = env().COOKIE_SECURE ? '; Secure' : '';
  return `${BU_COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=${BU_TTL_SECONDS}`;
}

export function clearBuCookieHeader(): string {
  const secure = env().COOKIE_SECURE ? '; Secure' : '';
  return `${BU_COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readBuCookieToken(req: Request): string | null {
  return readNamedCookie(req, BU_COOKIE);
}

function readNamedCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const prefix = `${name}=`;
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

export async function assertActiveSession(claims: {
  jti: string;
  realm: SessionRealm;
  sub: string;
  client_id?: string | null;
}): Promise<void> {
  const sql = db();
  const rows = (await sql`
    SELECT id
    FROM public.auth_sessions
    WHERE id = ${claims.jti}::uuid
      AND realm = ${claims.realm}
      AND subject_id = ${claims.sub}::uuid
      AND (${claims.client_id ?? null}::uuid IS NULL OR client_id = ${claims.client_id ?? null}::uuid)
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `) as { id: string }[];
  if (rows.length === 0) throw new Error('inactive_session');
}

export async function revokeSession(jti: string): Promise<void> {
  const sql = db();
  await sql`
    UPDATE public.auth_sessions
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE id = ${jti}::uuid
  `;
}

export async function revokeAllSessions(input: {
  realm: SessionRealm;
  subjectId: string;
  clientId?: string | null;
}): Promise<void> {
  const sql = db();
  await sql`
    UPDATE public.auth_sessions
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE realm = ${input.realm}
      AND subject_id = ${input.subjectId}::uuid
      AND (${input.clientId ?? null}::uuid IS NULL OR client_id = ${input.clientId ?? null}::uuid)
      AND revoked_at IS NULL
  `;
}

async function insertSession(input: {
  id: string;
  realm: SessionRealm;
  subjectId: string;
  clientId: string | null;
  email: string;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO public.auth_sessions (id, realm, subject_id, client_id, email, expires_at, ip, user_agent)
    VALUES (${input.id}::uuid, ${input.realm}, ${input.subjectId}::uuid, ${input.clientId}::uuid, ${input.email}, ${input.expiresAt.toISOString()}::timestamptz, ${input.ip}::inet, ${input.userAgent})
  `;
}
