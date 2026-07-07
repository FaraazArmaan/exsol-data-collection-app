import { describe, it, expect } from 'vitest';
import { postToProvider, isSocialProvider, PROVIDER_MAX_CHARS } from '../../src/modules/marketing/lib/social';

describe('social provider seam (mock)', () => {
  it('posts normal content with a synthetic ref', async () => {
    const r = await postToProvider('facebook', 'Hello world', 'id-abcdef123456');
    expect(r.status).toBe('posted');
    expect(r.providerRef).toContain('mock_facebook_');
  });

  it('fails content over the provider limit (X = 280)', async () => {
    const long = 'x'.repeat(PROVIDER_MAX_CHARS.x + 1);
    const r = await postToProvider('x', long, 'id1');
    expect(r.status).toBe('failed');
    expect(r.error).toContain('limit');
  });

  it('is deterministic (same key → same ref)', async () => {
    const a = await postToProvider('linkedin', 'hi', 'same-key-000');
    const b = await postToProvider('linkedin', 'hi', 'same-key-000');
    expect(a.providerRef).toBe(b.providerRef);
  });

  it('isSocialProvider guards the enum', () => {
    expect(isSocialProvider('instagram')).toBe(true);
    expect(isSocialProvider('tiktok')).toBe(false);
  });
});
