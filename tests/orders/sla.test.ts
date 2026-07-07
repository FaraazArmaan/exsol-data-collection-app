// tests/orders/sla.test.ts — SLA Task Time Tracking (Task 5)
import { describe, it, expect } from 'vitest';
import { neon } from '@neondatabase/serverless';
import { seedOrdersClient, seedSale, makeBucketUserRequest } from './_helpers';
import slaHandler from '../../netlify/functions/orders-sla';
import slaTargetsHandler from '../../netlify/functions/orders-sla-targets';

const sql = neon(process.env.DATABASE_URL!);

describe('orders SLA', () => {
  it('derived breach: paid_at 10 min ago, fulfilled_at now, target paid=1 min → breach ~10 > 1', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx);

    // Set paid_at 10 min ago and fulfilled_at to now so the derived timeline
    // shows ~10 min spent in the 'paid' stage.
    await sql`
      UPDATE public.sales
      SET paid_at = now() - INTERVAL '10 minutes',
          fulfilled_at = now()
      WHERE id = ${saleId}::uuid
    `;

    // PUT target: paid stage max 1 minute → should breach.
    const put1 = await slaTargetsHandler(
      makeBucketUserRequest(ctx, 'PUT', '/api/orders/sla-targets', {
        targets: [{ stage: 'paid', max_minutes: 1 }],
      }),
    );
    expect(put1.status).toBe(200);

    const get1 = await slaHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/sla'));
    expect(get1.status).toBe(200);
    const body1 = await get1.json();

    const breach = body1.breaches.find(
      (b: { sale_id: string; stage: string }) => b.sale_id === saleId && b.stage === 'paid',
    );
    expect(breach).toBeDefined();
    expect(breach.minutes).toBeGreaterThan(1);
    expect(breach.max_minutes).toBe(1);
    expect(body1.breach_count).toBeGreaterThanOrEqual(1);

    // Raise the target to 1000 min → no longer a breach.
    const put2 = await slaTargetsHandler(
      makeBucketUserRequest(ctx, 'PUT', '/api/orders/sla-targets', {
        targets: [{ stage: 'paid', max_minutes: 1000 }],
      }),
    );
    expect(put2.status).toBe(200);

    const get2 = await slaHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/sla'));
    expect(get2.status).toBe(200);
    const body2 = await get2.json();
    const breach2 = body2.breaches.find(
      (b: { sale_id: string; stage: string }) => b.sale_id === saleId && b.stage === 'paid',
    );
    expect(breach2).toBeUndefined();
  });

  it('orders-specific stage event: picking 30 min ago, no next → breach ~30 > 5', async () => {
    const ctx = await seedOrdersClient();
    const { saleId } = await seedSale(ctx);

    // Insert a picking stage event 30 minutes ago (open stage — no next event).
    await sql`
      INSERT INTO public.orders_stage_events (client_id, sale_id, stage, entered_at)
      VALUES (${ctx.clientId}::uuid, ${saleId}::uuid, 'picking'::order_stage, now() - INTERVAL '30 minutes')
    `;

    // PUT target: picking max 5 min → ~30 > 5 → breach.
    const putRes = await slaTargetsHandler(
      makeBucketUserRequest(ctx, 'PUT', '/api/orders/sla-targets', {
        targets: [{ stage: 'picking', max_minutes: 5 }],
      }),
    );
    expect(putRes.status).toBe(200);

    const getRes = await slaHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/sla'));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();

    const breach = body.breaches.find(
      (b: { sale_id: string; stage: string }) => b.sale_id === saleId && b.stage === 'picking',
    );
    expect(breach).toBeDefined();
    expect(breach.minutes).toBeGreaterThan(5);
    expect(breach.max_minutes).toBe(5);
  });

  it('PUT targets upserts: second PUT of same stage updates max_minutes, no duplicate', async () => {
    const ctx = await seedOrdersClient();

    // First PUT: packing=10
    const put1 = await slaTargetsHandler(
      makeBucketUserRequest(ctx, 'PUT', '/api/orders/sla-targets', {
        targets: [{ stage: 'packing', max_minutes: 10 }],
      }),
    );
    expect(put1.status).toBe(200);

    // Second PUT: packing=25 (should upsert, not duplicate)
    const put2 = await slaTargetsHandler(
      makeBucketUserRequest(ctx, 'PUT', '/api/orders/sla-targets', {
        targets: [{ stage: 'packing', max_minutes: 25 }],
      }),
    );
    expect(put2.status).toBe(200);

    // GET targets — exactly one packing row with max_minutes=25
    const getRes = await slaTargetsHandler(
      makeBucketUserRequest(ctx, 'GET', '/api/orders/sla-targets'),
    );
    expect(getRes.status).toBe(200);
    const targets = await getRes.json();
    const packingTargets = (targets as Array<{ stage: string; max_minutes: number }>).filter(
      (t) => t.stage === 'packing',
    );
    expect(packingTargets).toHaveLength(1);
    expect(packingTargets[0]!.max_minutes).toBe(25);
  });

  it('cross-tenant: sale from another client is excluded from breaches', async () => {
    const ctx = await seedOrdersClient();
    const ctx2 = await seedOrdersClient();

    // Seed a sale in ctx2 with paid_at 60 min ago → will breach against a 1 min target.
    const { saleId: otherSaleId } = await seedSale(ctx2);
    await sql`
      UPDATE public.sales
      SET paid_at = now() - INTERVAL '60 minutes',
          fulfilled_at = now()
      WHERE id = ${otherSaleId}::uuid
    `;

    // Give ctx2 a tight target so it definitely has a breach.
    await slaTargetsHandler(
      makeBucketUserRequest(ctx2, 'PUT', '/api/orders/sla-targets', {
        targets: [{ stage: 'paid', max_minutes: 1 }],
      }),
    );

    // GET sla for ctx (not ctx2) — should NOT see ctx2's breach.
    const getRes = await slaHandler(makeBucketUserRequest(ctx, 'GET', '/api/orders/sla'));
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    const otherBreach = body.breaches.find(
      (b: { sale_id: string }) => b.sale_id === otherSaleId,
    );
    expect(otherBreach).toBeUndefined();
  });
});
