import { SignJWT, jwtVerify } from 'jose';
import { env } from './env';

const ALG = 'HS256';
const TTL_SECONDS = 15 * 60;
const REFRESH_THRESHOLD_SECONDS = 10 * 60; // refresh if older than TTL - this

export interface SessionClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

function secret() {
  return new TextEncoder().encode(env().JWT_SIGNING_SECRET);
}

export async function mintSession(input: { sub: string; email: string }): Promise<string> {
  return new SignJWT({ email: input.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
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
  client_id: string;
  iat: number;
  exp: number;
}

export async function mintBucketUserSession(input: {
  sub: string; email: string; client_id: string;
}): Promise<string> {
  return new SignJWT({
    email: input.email,
    kind: 'bucket_user',
    client_id: input.client_id,
  })
    .setProtectedHeader({ alg: ALG })
    .setSubject(input.sub)
    .setIssuedAt()
    .setExpirationTime(`${BU_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifyBucketUserSession(token: string): Promise<BucketUserClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    payload.kind !== 'bucket_user' ||
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
