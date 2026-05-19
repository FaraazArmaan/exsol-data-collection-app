import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { pool } from './db.ts';
import { req } from './env.ts';
import { ACCESS_COOKIE_NAME, parseCookies } from './cookies.ts';

const ACCESS_TTL_SECONDS = 15 * 60;

let _secret: Uint8Array | null = null;
function secret(): Uint8Array {
  if (_secret) return _secret;
  _secret = new TextEncoder().encode(req('JWT_SIGNING_SECRET'));
  return _secret;
}

export type AccessClaims = {
  sub: string;
  v: number;
  iat: number;
  exp: number;
};

export type AuthedUser = {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
  isAdmin: boolean;
};

export type Issued = {
  accessToken: string;
  refreshToken: string;
};

export async function issue(userId: string): Promise<Issued> {
  const accessToken = await new SignJWT({ v: 1 })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secret());

  const refreshToken = randomBytes(32).toString('base64url');
  const refreshHash = createHash('sha256').update(refreshToken).digest('hex');

  const c = await pool().connect();
  try {
    await c.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '30 days')`,
      [userId, refreshHash],
    );
  } finally {
    c.release();
  }

  return { accessToken, refreshToken };
}

export async function verify(accessToken: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(accessToken, secret(), { algorithms: ['HS256'] });
    return payload as unknown as AccessClaims;
  } catch {
    return null;
  }
}

export async function refresh(refreshToken: string): Promise<Issued | null> {
  const hash = createHash('sha256').update(refreshToken).digest('hex');
  const c = await pool().connect();
  try {
    const r = await c.query(
      `SELECT id, user_id FROM refresh_tokens
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hash],
    );
    if ((r.rowCount ?? 0) === 0) return null;
    const row = r.rows[0];
    await c.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id]);
    return issue(row.user_id);
  } finally {
    c.release();
  }
}

export async function revoke(refreshToken: string): Promise<void> {
  const hash = createHash('sha256').update(refreshToken).digest('hex');
  const c = await pool().connect();
  try {
    await c.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1`, [hash]);
  } finally {
    c.release();
  }
}

export async function getCurrentUser(request: Request): Promise<AuthedUser | null> {
  const cookies = parseCookies(request.headers.get('cookie') ?? '');
  const at = cookies[ACCESS_COOKIE_NAME];
  if (!at) return null;
  const claims = await verify(at);
  if (!claims?.sub) return null;
  const c = await pool().connect();
  try {
    const r = await c.query(
      `SELECT id, email, name, photo_url, is_admin, disabled_at
       FROM users WHERE id = $1`,
      [claims.sub],
    );
    if ((r.rowCount ?? 0) === 0) return null;
    const u = r.rows[0];
    if (u.disabled_at) return null;
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      photoUrl: u.photo_url,
      isAdmin: u.is_admin,
    };
  } finally {
    c.release();
  }
}
