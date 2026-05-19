import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { verify as argonVerify } from '@node-rs/argon2';
import { pool } from './db.ts';
import { opt } from './env.ts';

export type Credentials =
  | { provider: 'google'; idToken: string }
  | { provider: 'email'; email: string; password: string };

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  photoUrl: string | null;
  isAdmin: boolean;
};

export type AuthError = {
  kind:
    | 'unknown_user'
    | 'invalid_token'
    | 'invalid_password'
    | 'user_disabled'
    | 'no_password_set'
    | 'email_not_verified'
    | 'misconfigured';
  detail?: string;
};

let _client: OAuth2Client | null = null;
function googleClient(): OAuth2Client {
  if (_client) return _client;
  const cid = opt('GOOGLE_OAUTH_CLIENT_ID');
  if (!cid) throw new Error('GOOGLE_OAUTH_CLIENT_ID not configured');
  _client = new OAuth2Client(cid);
  return _client;
}

export async function verifyCredentials(
  cred: Credentials,
): Promise<AuthenticatedUser | AuthError> {
  if (cred.provider === 'google') return verifyGoogle(cred.idToken);
  return verifyEmail(cred.email, cred.password);
}

async function verifyGoogle(idToken: string): Promise<AuthenticatedUser | AuthError> {
  const cid = opt('GOOGLE_OAUTH_CLIENT_ID');
  if (!cid) return { kind: 'misconfigured', detail: 'no_google_client_id' };

  let payload: TokenPayload | undefined;
  try {
    const ticket = await googleClient().verifyIdToken({ idToken, audience: cid });
    payload = ticket.getPayload();
  } catch (err) {
    return { kind: 'invalid_token', detail: String((err as Error).message ?? err) };
  }
  if (!payload?.sub || !payload.email) return { kind: 'invalid_token' };
  if (!payload.email_verified) return { kind: 'email_not_verified' };

  const sub = payload.sub;
  const email = payload.email.toLowerCase();
  const name = payload.name ?? email;
  const photoUrl = payload.picture ?? null;

  const c = await pool().connect();
  try {
    let res = await c.query(
      `SELECT id, email, name, photo_url, is_admin, disabled_at, google_sub
       FROM users WHERE google_sub = $1`,
      [sub],
    );

    if ((res.rowCount ?? 0) === 0) {
      res = await c.query(
        `SELECT id, email, name, photo_url, is_admin, disabled_at, google_sub
         FROM users WHERE email = $1`,
        [email],
      );
      if ((res.rowCount ?? 0) === 0) return { kind: 'unknown_user' };

      const row = res.rows[0];
      if (row.google_sub && row.google_sub !== sub) {
        return { kind: 'invalid_token', detail: 'sub_mismatch' };
      }
      if (!row.google_sub) {
        await c.query(
          `UPDATE users
           SET google_sub = $1,
               name = COALESCE($2, name),
               photo_url = COALESCE($3, photo_url),
               email_verified = true,
               updated_at = now()
           WHERE id = $4`,
          [sub, name, photoUrl, row.id],
        );
      }
    }

    const u = res.rows[0];
    if (u.disabled_at) return { kind: 'user_disabled' };

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

async function verifyEmail(
  emailRaw: string,
  password: string,
): Promise<AuthenticatedUser | AuthError> {
  const email = emailRaw.toLowerCase().trim();
  const c = await pool().connect();
  try {
    const r = await c.query(
      `SELECT id, email, name, photo_url, is_admin, disabled_at,
              password_hash, email_verified
       FROM users WHERE email = $1`,
      [email],
    );
    if ((r.rowCount ?? 0) === 0) return { kind: 'unknown_user' };
    const u = r.rows[0];
    if (u.disabled_at) return { kind: 'user_disabled' };
    if (!u.password_hash) return { kind: 'no_password_set' };
    if (!u.email_verified) return { kind: 'email_not_verified' };

    const ok = await argonVerify(u.password_hash, password);
    if (!ok) return { kind: 'invalid_password' };

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
