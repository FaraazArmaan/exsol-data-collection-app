import { rejectCrossSiteMutation } from '../../netlify/functions/_shared/csrf';

async function code(res: Response | null): Promise<string | null> {
  if (!res) return null;
  const body = await res.json() as { error: { code: string } };
  return body.error.code;
}

describe('rejectCrossSiteMutation', () => {
  it('allows safe methods without an Origin header', () => {
    const req = new Request('https://app.example.test/api/auth-me');
    expect(rejectCrossSiteMutation(req)).toBeNull();
  });

  it('allows unsafe same-origin requests', () => {
    const req = new Request('https://app.example.test/api/auth-login', {
      method: 'POST',
      headers: { origin: 'https://app.example.test' },
    });
    expect(rejectCrossSiteMutation(req)).toBeNull();
  });

  it('uses forwarded host/proto when Netlify supplies them', () => {
    const req = new Request('http://internal.local/api/auth-login', {
      method: 'POST',
      headers: {
        origin: 'https://tenant.example.com',
        host: 'tenant.example.com',
        'x-forwarded-proto': 'https',
      },
    });
    expect(rejectCrossSiteMutation(req)).toBeNull();
  });

  it('rejects cross-site unsafe requests', async () => {
    const req = new Request('https://app.example.test/api/auth-login', {
      method: 'POST',
      headers: { origin: 'https://evil.example.test' },
    });
    expect(await code(rejectCrossSiteMutation(req))).toBe('csrf_origin_mismatch');
  });

  it('rejects production-like unsafe requests with no Origin header', async () => {
    const prevVitest = process.env.VITEST;
    const prevNodeEnv = process.env.NODE_ENV;
    delete process.env.VITEST;
    process.env.NODE_ENV = 'production';
    try {
      const req = new Request('https://app.example.test/api/auth-login', { method: 'POST' });
      expect(await code(rejectCrossSiteMutation(req))).toBe('csrf_origin_required');
    } finally {
      if (prevVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = prevVitest;
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }
  });
});
