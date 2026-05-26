import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../netlify/functions/_shared/env';

describe('env', () => {
  it('throws when DATABASE_URL is missing', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
  it('parses a valid env', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://x',
      GOOGLE_OAUTH_CLIENT_ID: 'gid',
      JWT_SIGNING_SECRET: 'a'.repeat(32),
      COOKIE_SECURE: 'true',
      NODE_ENV: 'production',
    });
    expect(env.DATABASE_URL).toBe('postgres://x');
    expect(env.COOKIE_SECURE).toBe(true);
  });
});
