import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyHmacSignature } from '../../netlify/functions/_shared/webhook';
import handler from '../../netlify/functions/webhook-example';

const SECRET = 'whsec-' + Math.random().toString(36).slice(2);
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('hex');

function makeReq(body: string, sig: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sig !== null) headers['x-exsol-signature'] = sig;
  return new Request('http://localhost/api/webhook-example', { method: 'POST', headers, body });
}

describe('verifyHmacSignature', () => {
  const body = JSON.stringify({ event: 'ping', at: 123 });
  it('accepts a correct signature', () => expect(verifyHmacSignature(body, sign(body), SECRET)).toBe(true));
  it('rejects a tampered body', () => expect(verifyHmacSignature(body + 'x', sign(body), SECRET)).toBe(false));
  it('rejects a wrong secret', () => expect(verifyHmacSignature(body, sign(body, 'other-secret'), SECRET)).toBe(false));
  it('rejects empty / missing inputs', () => {
    expect(verifyHmacSignature('', sign(body), SECRET)).toBe(false);
    expect(verifyHmacSignature(body, '', SECRET)).toBe(false);
    expect(verifyHmacSignature(body, sign(body), '')).toBe(false);
  });
});

describe('POST /api/webhook-example', () => {
  beforeAll(() => { process.env.WEBHOOK_EXAMPLE_SECRET = SECRET; });
  const body = JSON.stringify({ event: 'ping' });

  it('200 on a valid signature', async () => {
    const res = await handler(makeReq(body, sign(body)));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { received: boolean }).received).toBe(true);
  });
  it('401 on an invalid signature', async () => {
    expect((await handler(makeReq(body, 'deadbeef'))).status).toBe(401);
  });
  it('401 when the signature header is missing', async () => {
    expect((await handler(makeReq(body, null))).status).toBe(401);
  });
});
