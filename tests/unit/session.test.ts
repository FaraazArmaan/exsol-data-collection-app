import { describe, it, expect, beforeAll } from 'vitest';
import { mintSession, verifySession } from '../../netlify/functions/_shared/session';

beforeAll(() => {
  process.env.JWT_SIGNING_SECRET = 'a'.repeat(32);
  process.env.DATABASE_URL = 'postgres://x';
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'gid';
  process.env.COOKIE_SECURE = 'false';
});

describe('session', () => {
  it('mints and verifies a token', async () => {
    const token = await mintSession({ sub: 'admin-1', email: 'a@b.com' });
    const claims = await verifySession(token);
    expect(claims.sub).toBe('admin-1');
    expect(claims.email).toBe('a@b.com');
  });
  it('rejects a tampered token', async () => {
    const token = await mintSession({ sub: 'admin-1', email: 'a@b.com' });
    const tampered = token.slice(0, -2) + 'xx';
    await expect(verifySession(tampered)).rejects.toThrow();
  });
});
