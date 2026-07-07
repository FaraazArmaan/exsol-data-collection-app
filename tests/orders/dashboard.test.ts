// tests/orders/dashboard.test.ts
import { describe, it, expect } from 'vitest';
import dashboardHandler from '../../netlify/functions/orders-dashboard';
import { seedOrdersClient, seedSale, makeBucketUserRequest } from './_helpers';
import { seedClientWithProductsEnabled } from '../pos/_helpers';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function enableOrders(clientId: string, adminId: string): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${clientId}, 'orders', ${adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

describe('orders dashboard', () => {
  it('returns correct by_status counts, open.n, avg_fulfil_secs and base_currency', async () => {
    const ctx = await seedOrdersClient();

    // Sale 1: paid, instore — counts in open
    const now = new Date().toISOString();
    const twoHoursLater = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    await seedSale(ctx, { status: 'paid', channel: 'instore', total: 2000, paid_at: now });
    // Sale 2: pending_payment, online — counts in open
    await seedSale(ctx, { status: 'pending_payment', channel: 'online', total: 1500 });
    // Sale 3: fulfilled, pickup — has paid_at + fulfilled_at so avg_fulfil_secs > 0
    await seedSale(ctx, {
      status: 'fulfilled',
      channel: 'pickup',
      total: 3000,
      paid_at: now,
      fulfilled_at: twoHoursLater,
    });

    const res = await dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/dashboard'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // by_status should contain rows for paid, pending_payment, fulfilled
    const statusPaid = body.by_status.find((r: { status: string }) => r.status === 'paid');
    const statusPending = body.by_status.find((r: { status: string }) => r.status === 'pending_payment');
    const statusFulfilled = body.by_status.find((r: { status: string }) => r.status === 'fulfilled');
    expect(statusPaid).toBeDefined();
    expect(statusPaid.n).toBe(1);
    expect(statusPaid.cents).toBe(2000);
    expect(statusPending).toBeDefined();
    expect(statusPending.n).toBe(1);
    expect(statusFulfilled).toBeDefined();
    expect(statusFulfilled.n).toBe(1);

    // open = paid + pending_payment (2 sales)
    expect(body.open.n).toBe(2);
    expect(body.open.cents).toBe(3500); // 2000 + 1500

    // avg fulfil secs > 0 (sale 3 has paid_at → fulfilled_at ~2h apart)
    expect(body.avg_fulfil_secs).toBeGreaterThan(0);

    // base_currency is present
    expect(body.base_currency).toBeTruthy();

    // literal stubs
    expect(body.backorders_active).toBe(0);
    expect(body.sla_breaches).toBe(0);
  });

  it('excludes sales from a different client (cross-client isolation)', async () => {
    const ctx = await seedOrdersClient();

    // Seed a sale for this client
    await seedSale(ctx, { status: 'paid', channel: 'instore', total: 9999 });

    // Seed a second client with orders enabled and a sale in it
    const otherBase = await seedClientWithProductsEnabled();
    await enableOrders(otherBase.clientId, otherBase.adminId);
    // Insert a sale for the other client (using their user_node as creator)
    await sql`
      INSERT INTO public.sales
        (bucket_id, order_no, status, channel,
         customer_name, customer_phone,
         subtotal_cents, discount_cents, tax_cents, total_cents,
         created_by_user_node)
      VALUES
        (${otherBase.clientId}::uuid,
         ${Math.floor(100000 + Math.random() * 900000)},
         'paid', 'instore',
         'Other Customer', '+19999999999',
         500000, 0, 0, 500000,
         ${otherBase.userNodeId}::uuid)
    `;

    const res = await dashboardHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/dashboard'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Ensure the other client's large sale (500000 cents) is not counted
    const totalCents = body.by_status.reduce(
      (sum: number, r: { cents: number }) => sum + r.cents,
      0,
    );
    expect(totalCents).toBeLessThan(500000);
  });
});
