// Deterministic analytics test seeding. Inserts paid sales (and one sale_line
// each) directly via the DB so series/KPI assertions are exact and fast, rather
// than driving the POS create→markPaid flow. Each call seeds a fresh client
// (its own bucket) so order_no/unique constraints never collide across re-runs
// on the shared dev DB.

import { db } from '../../netlify/functions/_shared/db';
import { seedClientWithProductsEnabled, seedProducts, grantPerms, type PosTestCtx } from '../pos/_helpers';

// Enable the analytics Product for a client so the authz enable-gate passes.
// The enable-gate runs BEFORE the permission check, so any analytics test
// expecting 200/403 must enable the product first (otherwise it gets 412).
export async function enableAnalytics(ctx: { clientId: string; adminId: string }): Promise<void> {
  const sql = db();
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'analytics', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

interface SeedPaidSalesArgs {
  when: string[];          // ISO timestamps (one per sale), e.g. '2026-03-02T10:00:00Z'
  channel?: string[];      // 'instore' | 'online' | 'pickup' per sale; defaults all 'instore'
  priceCents?: number;     // per-sale total; default 1000
}

export async function seedPaidSales(args: SeedPaidSalesArgs): Promise<PosTestCtx> {
  const sql = db();
  const price = args.priceCents ?? 1000;
  const ctx = await seedClientWithProductsEnabled();
  await enableAnalytics(ctx);
  await grantPerms(ctx.clientId, 1, ['analytics.business.view']);

  const suffix = Math.random().toString(36).slice(2, 7);
  const [productId] = await seedProducts(ctx.clientId, [
    { name: `AN-${suffix}`, sale_price_cents: price, pos_visible: true, status: 'active' },
  ]);

  for (let i = 0; i < args.when.length; i++) {
    const channel = args.channel?.[i] ?? 'instore';
    const createdAt = args.when[i]!;
    const saleRows = (await sql`
      INSERT INTO public.sales
        (bucket_id, order_no, status, channel, customer_name, customer_phone,
         subtotal_cents, discount_cents, tax_cents, total_cents,
         created_by_user_node, source, created_at, paid_at)
      VALUES
        (${ctx.clientId}::uuid, ${i + 1}, 'paid', ${channel}, 'Seed', ${`9${i}`},
         ${price}, 0, 0, ${price},
         ${ctx.userNodeId}::uuid, 'pos', ${createdAt}::timestamptz, ${createdAt}::timestamptz)
      RETURNING id
    `) as Array<{ id: string }>;
    const saleId = saleRows[0]!.id;
    await sql`
      INSERT INTO public.sale_lines
        (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
      VALUES
        (${saleId}::uuid, ${productId}::uuid, ${`AN-${suffix}`}, ${price}, 1, ${price}, 1)
    `;
  }
  return ctx;
}

// Low-level single-sale insert for scoping tests. Attributes a sale to a
// specific node (or null for storefront — the DB CHECK requires source
// 'storefront' ⇒ created_by_user_node IS NULL).
export async function insertSale(
  clientId: string,
  opts: {
    nodeId: string | null;
    source: 'pos' | 'storefront';
    channel: string;
    priceCents: number;
    when: string;
    productId: string;
    orderNo: number;
    status?: string;
  },
): Promise<string> {
  const sql = db();
  const status = opts.status ?? 'paid';
  const rows = (await sql`
    INSERT INTO public.sales
      (bucket_id, order_no, status, channel, customer_name, customer_phone,
       subtotal_cents, discount_cents, tax_cents, total_cents,
       created_by_user_node, source, created_at, paid_at)
    VALUES
      (${clientId}::uuid, ${opts.orderNo}, ${status}, ${opts.channel}, 'Seed', ${`9${opts.orderNo}`},
       ${opts.priceCents}, 0, 0, ${opts.priceCents},
       ${opts.nodeId}::uuid, ${opts.source}, ${opts.when}::timestamptz, ${opts.when}::timestamptz)
    RETURNING id
  `) as Array<{ id: string }>;
  const saleId = rows[0]!.id;
  await sql`
    INSERT INTO public.sale_lines
      (sale_id, product_id, product_name_snap, unit_price_cents, qty, line_total_cents, position)
    VALUES
      (${saleId}::uuid, ${opts.productId}::uuid, 'Seed', ${opts.priceCents}, 1, ${opts.priceCents}, 1)
  `;
  return saleId;
}

// Seed a single active product, returning its id (thin wrapper for clarity).
export async function seedOneProduct(clientId: string, priceCents = 1000): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 7);
  const [id] = await seedProducts(clientId, [
    { name: `AN-${suffix}`, sale_price_cents: priceCents, pos_visible: true, status: 'active' },
  ]);
  return id!;
}
