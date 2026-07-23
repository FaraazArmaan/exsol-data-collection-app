import { describe, expect, it, vi } from 'vitest';

const blobState = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('@netlify/blobs', () => {
  return {
    getStore: () => ({
      get: async (key: string) => blobState.store.get(key) ?? null,
      setJSON: async (key: string, value: unknown) => {
        blobState.store.set(key, JSON.stringify(value));
      },
    }),
  };
});

import { neon } from '@neondatabase/serverless';
import access from '../../netlify/functions/orders-return-access';
import publicReturns from '../../netlify/functions/pub-orders-returns';
import { makeBucketUserRequest, seedOrdersClient, seedProducts, seedSale } from './_helpers';

const sql = neon(process.env.DATABASE_URL!);
let ipCounter = 7200;

function publicRequest(
  method: 'GET' | 'POST',
  token: string,
  body?: unknown,
  clientIp?: string,
): Request {
  return new Request('http://localhost/api/public/returns', {
    method,
    headers: {
      ...(method === 'GET'
        ? { authorization: `Bearer ${token}` }
        : { 'content-type': 'application/json' }),
      'x-nf-client-connection-ip':
        clientIp ?? `10.28.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function issuedAccessToken() {
  const ctx = await seedOrdersClient();
  const { saleId } = await seedSale(ctx, { status: 'fulfilled', channel: 'pickup', total: 200 });
  const [productId] = await seedProducts(ctx.clientId, [
    { name: `Public return ${crypto.randomUUID()}`, price_cents: 100 },
  ]);
  const saleLines = (await sql`
    INSERT INTO public.sale_lines (sale_id,product_id,product_name_snap,unit_price_cents,qty,line_total_cents,position)
    VALUES (${saleId}::uuid,${productId}::uuid,'Public return',100,2,200,1)
    RETURNING id
  `) as Array<{ id: string }>;
  const response = await access(
    makeBucketUserRequest(ctx, 'POST', '/api/orders/returns/access', { sale_id: saleId }),
  );
  expect(response.status).toBe(201);
  const issued = (await response.json()) as { return_access_token: string; expires_at: string };
  return { ctx, saleId, saleLineId: saleLines[0]!.id, ...issued };
}

describe('public Orders return adapter', () => {
  it('creates and reads only a customer-safe canonical return projection', async () => {
    const setup = await issuedAccessToken();
    const key = crypto.randomUUID();
    const created = await publicReturns(
      publicRequest('POST', setup.return_access_token, {
        return_access_token: setup.return_access_token,
        idempotency_key: key,
        reason: 'Changed my mind',
        lines: [{ sale_line_id: setup.saleLineId, qty: 1, reason: 'Changed my mind' }],
      }),
    );
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      return_case_id: string;
      lines: Array<{
        sale_line_id: string;
        inventory_receipt_state: string;
        refund_state: string | null;
      }>;
    };
    expect(body).toMatchObject({
      return_case_id: expect.any(String),
      status: 'requested',
      authorisation_message: 'Return request received.',
      lines: [
        {
          sale_line_id: setup.saleLineId,
          qty: 1,
          inventory_receipt_state: 'not_received',
          refund_state: null,
        },
      ],
    });
    const text = JSON.stringify(body);
    expect(text).not.toContain(setup.ctx.clientId);
    expect(text).not.toContain(setup.ctx.userNodeId);
    expect(text).not.toContain(setup.saleId);

    const retry = await publicReturns(
      publicRequest('POST', setup.return_access_token, {
        return_access_token: setup.return_access_token,
        idempotency_key: key,
        lines: [{ sale_line_id: setup.saleLineId, qty: 1 }],
      }),
    );
    expect(retry.status).toBe(200);
    expect((await retry.json()).return_case_id).toBe(body.return_case_id);

    const timeline = await publicReturns(publicRequest('GET', setup.return_access_token));
    expect(timeline.status).toBe(200);
    expect((await timeline.json()).return_cases).toEqual([
      expect.objectContaining({ return_case_id: body.return_case_id }),
    ]);

    const effects = (await sql`
      SELECT inventory_return_id, refund_id
      FROM public.orders_return_case_lines
      WHERE return_case_id=${body.return_case_id}::uuid
    `) as Array<{ inventory_return_id: string | null; refund_id: string | null }>;
    expect(effects[0]).toEqual({ inventory_return_id: null, refund_id: null });
  });

  it('makes expired, revoked, and guessed access tokens indistinguishable', async () => {
    const setup = await issuedAccessToken();
    await sql`
      UPDATE public.orders_return_access_tokens
      SET created_at=now() - interval '2 days', expires_at=now() - interval '1 second'
      WHERE sale_id=${setup.saleId}::uuid AND revoked_at IS NULL
    `;
    const expired = await publicReturns(publicRequest('GET', setup.return_access_token));
    expect(expired.status).toBe(404);
    expect((await expired.json()).error.code).toBe('not_found');

    const replacement = await access(
      makeBucketUserRequest(setup.ctx, 'POST', '/api/orders/returns/access', {
        sale_id: setup.saleId,
      }),
    );
    const reissued = (await replacement.json()) as { return_access_token: string };
    const revoked = await access(
      makeBucketUserRequest(setup.ctx, 'DELETE', '/api/orders/returns/access', {
        sale_id: setup.saleId,
      }),
    );
    expect(revoked.status).toBe(204);
    for (const token of [reissued.return_access_token, 'not-a-real-return-token']) {
      const response = await publicReturns(publicRequest('GET', token));
      expect(response.status).toBe(404);
      expect((await response.json()).error.code).toBe('not_found');
    }
  });

  it('does not use a raw sale id as public authority', async () => {
    const setup = await issuedAccessToken();
    const response = await publicReturns(
      publicRequest('POST', setup.saleId, {
        return_access_token: setup.saleId,
        idempotency_key: crypto.randomUUID(),
        lines: [{ sale_line_id: setup.saleLineId, qty: 1 }],
      }),
    );
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('not_found');
  });

  it('rate-limits repeated public timeline reads from one IP', async () => {
    const setup = await issuedAccessToken();
    const sameIp = '10.29.0.1';
    for (let attempt = 0; attempt < 30; attempt += 1) {
      expect(
        (await publicReturns(publicRequest('GET', setup.return_access_token, undefined, sameIp)))
          .status,
      ).toBe(200);
    }
    const limited = await publicReturns(
      publicRequest('GET', setup.return_access_token, undefined, sameIp),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).error.code).toBe('rate_limit_ip');
  });
});
