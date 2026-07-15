import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import providerConnection from '../../netlify/functions/payments-provider-connection';
import { decryptPaymentSecret } from '../../netlify/functions/_payments-secrets';
import { bookingRequest, demoteToL2, enableBooking, grantBookingPerms, seedClientWithBooking, sqlClient } from '../booking/_helpers';

const sql = sqlClient();
let owner: Awaited<ReturnType<typeof seedClientWithBooking>>;
const originalKey = process.env.PAYMENTS_ENCRYPTION_KEY;

beforeAll(async () => {
  process.env.PAYMENTS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  owner = await seedClientWithBooking();
  await enableBooking(owner.clientId);
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.PAYMENTS_ENCRYPTION_KEY;
  else process.env.PAYMENTS_ENCRYPTION_KEY = originalKey;
});

describe('/api/payments/provider-connection', () => {
  it('stores write-only Test-mode credentials encrypted and rejects incomplete enablement', async () => {
    const initial = await providerConnection(bookingRequest(owner, 'GET', '/api/payments/provider-connection'));
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ provider: 'razorpay', mode: 'test', enabled: false, configured: false });

    const incomplete = await providerConnection(bookingRequest(owner, 'PATCH', '/api/payments/provider-connection', { enabled: true }));
    expect(incomplete.status).toBe(400);
    expect((await incomplete.json()).error.code).toBe('online_requires_credentials');

    const saved = await providerConnection(bookingRequest(owner, 'PATCH', '/api/payments/provider-connection', {
      enabled: true, key_id: 'rzp_test_providerconnection', api_secret: 'api-test-secret', webhook_secret: 'webhook-test-secret',
    }));
    expect(saved.status).toBe(200);
    const body = await saved.json();
    expect(body).toMatchObject({ enabled: true, configured: true, key_id_configured: true, api_secret_configured: true, webhook_secret_configured: true });
    expect(JSON.stringify(body)).not.toContain('api-test-secret');
    expect(JSON.stringify(body)).not.toContain('webhook-test-secret');
    const safeRead = await providerConnection(bookingRequest(owner, 'GET', '/api/payments/provider-connection'));
    expect(JSON.stringify(await safeRead.json())).not.toMatch(/api-test-secret|webhook-test-secret/);

    const rows = await sql`
      SELECT api_secret_enc, webhook_secret_enc FROM public.payment_provider_connections
      WHERE client_id = ${owner.clientId}::uuid AND provider = 'razorpay' AND mode = 'test'
    ` as Array<{ api_secret_enc: string; webhook_secret_enc: string }>;
    expect(rows[0]!.api_secret_enc).not.toContain('api-test-secret');
    expect(decryptPaymentSecret(rows[0]!.api_secret_enc)).toBe('api-test-secret');
    expect(decryptPaymentSecret(rows[0]!.webhook_secret_enc)).toBe('webhook-test-secret');

    const otherTenant = await seedClientWithBooking();
    await enableBooking(otherTenant.clientId);
    const isolated = await providerConnection(bookingRequest(otherTenant, 'GET', '/api/payments/provider-connection'));
    expect(await isolated.json()).toMatchObject({ configured: false, enabled: false });

    const liveKey = await providerConnection(bookingRequest(owner, 'PATCH', '/api/payments/provider-connection', { key_id: 'rzp_live_not_allowed' }));
    expect(liveKey.status).toBe(400);
  });

  it('enforces the Payments permission matrix for read and edit access', async () => {
    const l2 = await demoteToL2(owner);
    const noView = await providerConnection(bookingRequest(l2, 'GET', '/api/payments/provider-connection'));
    expect(noView.status).toBe(403);
    await grantBookingPerms(owner.clientId, 2, ['payments.products.view']);
    const canView = await providerConnection(bookingRequest(l2, 'GET', '/api/payments/provider-connection'));
    expect(canView.status).toBe(200);
    const cannotEdit = await providerConnection(bookingRequest(l2, 'PATCH', '/api/payments/provider-connection', { enabled: false }));
    expect(cannotEdit.status).toBe(403);
  });
});
