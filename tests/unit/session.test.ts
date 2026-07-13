import { describe, it, expect, beforeAll } from 'vitest';
import { mintSession, verifySession, shouldRefreshBucketUser, type BucketUserClaims } from '../../netlify/functions/_shared/session';

beforeAll(() => {
  process.env.JWT_SIGNING_SECRET = 'a'.repeat(32);
  process.env.DATABASE_URL = 'postgres://x';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
  process.env.COOKIE_SECURE = 'false';
});

describe('session', () => {
  it('mints and verifies a token', async () => {
    const token = await mintSession({ sub: 'admin-1', email: 'a@b.com' }, { persist: false });
    const claims = await verifySession(token);
    expect(claims.sub).toBe('admin-1');
    expect(claims.email).toBe('a@b.com');
  });
  it('rejects a tampered token', async () => {
    const token = await mintSession({ sub: 'admin-1', email: 'a@b.com' }, { persist: false });
    const tampered = token.slice(0, -2) + 'xx';
    await expect(verifySession(tampered)).rejects.toThrow();
  });

  it('does not immediately refresh a fresh impersonated bucket-user session', () => {
    const now = 1_000;
    const claims = {
      sub: 'node-1',
      email: 'u@example.com',
      kind: 'bucket_user',
      realm: 'bucket_user',
      client_id: 'client-1',
      impersonated_by_admin: 'admin-1',
      jti: 'session-1',
      iat: now,
      exp: now + 60 * 60,
    } satisfies BucketUserClaims;

    expect(shouldRefreshBucketUser(claims, now)).toBe(false);
    expect(shouldRefreshBucketUser(claims, now + 31 * 60)).toBe(true);
  });
});
