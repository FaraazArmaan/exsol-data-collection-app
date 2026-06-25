import { describe, it, expect } from 'vitest';
import menuHandler   from '../../netlify/functions/pos-menu';
import createHandler from '../../netlify/functions/pos-sale-create';
import detailHandler from '../../netlify/functions/pos-sale-detail';
import stateHandler  from '../../netlify/functions/pos-sale-state';
import {
  seedClientWithProductsEnabled, seedProducts, grantPerms, makeBucketUserRequest,
} from './_helpers';

describe('POS round-trip', () => {
  it('menu → create → markPaid (instore auto-fulfills) → detail mirrors transitions', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await seedProducts(ctx.clientId, [
      { name: 'Cap',   sale_price_cents: 22000, pos_visible: true, status: 'active' },
      { name: 'Pasta', sale_price_cents: 52000, pos_visible: true, status: 'active' },
    ]);
    await grantPerms(ctx.clientId, 1, [
      'pos.menu.view', 'pos.sale.create', 'pos.sale.markPaid',
      'pos.history.view', 'pos.history.viewAll',
    ]);

    // 1. Menu lists both products
    const menuRes = await menuHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/menu'));
    expect(menuRes.status).toBe(200);
    const menu = await menuRes.json();
    expect(menu.products).toHaveLength(2);

    // 2. Create sale with both products
    const createRes = await createHandler(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore',
      idempotencyKey: crypto.randomUUID(),
      customer: { name: 'R', phone: '9' },
      lines: menu.products.map((p: any) => ({ productId: p.id, qty: 1 })),
    }));
    expect(createRes.status).toBe(201);
    const sale = await createRes.json();
    expect(Number(sale.total_cents)).toBe(22000 + 52000);
    expect(sale.status).toBe('pending_payment');

    // 3. markPaid on instore — should auto-fulfill
    const paidRes = await stateHandler(makeBucketUserRequest(ctx, 'POST',
      `/api/pos/sales/${sale.id}/state`, { action: 'markPaid', paymentMethod: 'cash' }));
    expect(paidRes.status).toBe(200);
    const paid = await paidRes.json();
    expect(paid.status).toBe('fulfilled');

    // 4. Detail mirrors everything + has audit trail
    const detailRes = await detailHandler(makeBucketUserRequest(ctx, 'GET',
      `/api/pos/sales/${sale.id}`));
    expect(detailRes.status).toBe(200);
    const detail = await detailRes.json();
    expect(detail.id).toBe(sale.id);
    expect(detail.status).toBe('fulfilled');
    expect(detail.lines).toHaveLength(2);
    expect(detail.audit.length).toBeGreaterThanOrEqual(2); // created + markPaid (+ auto fulfill)

    const ops = detail.audit.map((a: any) => a.op);
    expect(ops).toContain('pos.sale.created');
    expect(ops).toContain('pos.sale.markPaid');
    expect(ops).toContain('pos.sale.fulfill'); // the auto-fulfill audit row
  });
});
