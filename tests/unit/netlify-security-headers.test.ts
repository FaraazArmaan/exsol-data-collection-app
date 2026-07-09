import { readFileSync } from 'node:fs';

const toml = readFileSync(new URL('../../netlify.toml', import.meta.url), 'utf8');

describe('netlify security headers', () => {
  it('defines the platform security header block', () => {
    expect(toml).toContain('[[headers]]');
    expect(toml).toContain('Content-Security-Policy');
    expect(toml).toContain("frame-ancestors 'none'");
    expect(toml).toContain('Strict-Transport-Security');
    expect(toml).toContain('X-Content-Type-Options = "nosniff"');
    expect(toml).toContain('X-Frame-Options = "DENY"');
    expect(toml).toContain('Referrer-Policy = "strict-origin-when-cross-origin"');
    expect(toml).toContain('Permissions-Policy');
  });

  it('keeps Google Sign-In allowed by CSP', () => {
    expect(toml).toContain('script-src');
    expect(toml).toContain('https://accounts.google.com');
    expect(toml).toContain('frame-src https://accounts.google.com');
  });
});
