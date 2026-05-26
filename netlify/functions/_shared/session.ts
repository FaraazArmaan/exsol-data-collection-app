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
  const cookie = req.headers.get('cookie');
  if (!cookie) return null;
  const match = cookie.split(/;\s*/).find((c) => c.startsWith('session='));
  return match ? match.slice('session='.length) : null;
}
