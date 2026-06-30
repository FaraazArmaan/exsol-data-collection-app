// v1 endpoint updates for storefront sales (spec §5.5):
//  - pos-sales-list returns `source`; storefront rows show with viewAll, hide
//    without (they have no creator, so the own-only filter excludes them).
//  - pos-sale-detail: storefront sales are visible to any pos.history.view
//    holder (no cashier owns them), while pos sales stay own-only sans viewAll.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@netlify/blobs', () => {
  const store = new Map<string, string>();
  return {
    getStore: () => ({
      get: async (k: string) => store.get(k) ?? null,
      setJSON: async (k: string, v: unknown) => { store.set(k, JSON.stringify(v)); },
    }),
  };
});

import { neon } from '@neondatabase/serverless';
import listHandler from '../../netlify/functions/pos-sales-list';
import detailHandler from '../../netlify/functions/pos-sale-detail';
import createPub from '../../netlify/functions/pub-sale-create';
import createPos from '../../netlify/functions/pos-sale-create';
import {
  seedClientWithProductsEnabled, seedProducts, grantPerms, makeBucketUserRequest, type PosTestCtx,
} from './_helpers';
import { mintBucketUserSession } from '../../netlify/functions/_shared/session';
import { hashPassword } from '../../netlify/functions/_shared/argon';

const sql = neon(process.env.DATABASE_URL!);

async function seedL2(base: PosTestCtx, keys: string[]): Promise<PosTestCtx> {
  const perms = JSON.stringify(Object.fromEntries(keys.map((k) => [k, true])));
  await sql`
    INSERT INTO public.client_levels (client_id, level_number, label, permissions)
    VALUES (${base.clientId}, 2, 'L2', ${perms}::jsonb)
    ON CONFLICT (client_id, level_number) DO UPDATE SET permissions = ${perms}::jsonb
  `;
  const role = (await sql`SELECT id FROM public.client_roles WHERE client_id = ${base.clientId} LIMIT 1`) as Array<{ id: string }>;
  const email = `v1sf-l2-${Math.random().toString(36).slice(2, 8)}@exsol.test`;
  const node = (await sql`
    INSERT INTO public.user_nodes (client_id, parent_id, level_number, role_id, display_name, email, created_by_admin)
    VALUES (${base.clientId}, ${base.userNodeId}, 2, ${role[0]!.id}, 'L2', ${email}, ${base.adminId})
    RETURNING id
  `) as Array<{ id: string }>;
  const hash = await hashPassword('l2-pw');
  await sql`
    INSERT INTO public.user_node_credentials (client_id, user_node_id, email, password_hash, must_change_password, created_by_admin)
    VALUES (${base.clientId}, ${node[0]!.id}, ${email}, ${hash}, false, ${base.adminId})
  `;
  const token = await mintBucketUserSession({ sub: node[0]!.id, email, client_id: base.clientId });
  return { clientId: base.clientId, userNodeId: node[0]!.id, adminId: base.adminId, cookie: `bu_session=${token}` };
}

// Enables the storefront on the L1 ctx's client and returns its slug.
async function enableStorefront(clientId: string): Promise<string> {
  const r = (await sql`UPDATE public.clients SET storefront_enabled = true WHERE id = ${clientId} RETURNING slug`) as Array<{ slug: string }>;
  return r[0]!.slug;
}

async function makeStorefrontSale(slug: string, productId: string, ip: string): Promise<string> {
  const res = await createPub(new Request('http://localhost/api/public/sales', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip },
    body: JSON.stringify({
      slug, channel: 'pickup', idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
      honeypot: '', customer: { name: 'Guest', phone: '9001112223' }, lines: [{ productId, qty: 1 }],
    }),
  }));
  return (await res.json() as { id: string }).id;
}

describe('v1 endpoints + storefront source', () => {
  it('sales-list: L1 (viewAll) sees storefront sale with source; L2 (no viewAll) does not', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, ['pos.history.view', 'pos.history.viewAll']);
    const slug = await enableStorefront(ctx.clientId);
    const [pid] = await seedProducts(ctx.clientId, [{ name: 'Wide', sale_price_cents: 4000, status: 'active' }]);
    const sfId = await makeStorefrontSale(slug, pid!, '10.3.0.1');

    // L1 owner — viewAll via bypass — sees it, tagged source=storefront.
    const l1 = await listHandler(makeBucketUserRequest(ctx, 'GET', '/api/pos/sales'));
    const l1body = await l1.json() as { sales: Array<{ id: string; source: string }> };
    const found = l1body.sales.find((s) => s.id === sfId);
    expect(found).toBeTruthy();
    expect(found!.source).toBe('storefront');

    // L2 with history.view but NOT viewAll — storefront row hidden (no creator).
    const l2 = await seedL2(ctx, ['pos.history.view']);
    const l2res = await listHandler(makeBucketUserRequest(l2, 'GET', '/api/pos/sales'));
    const l2body = await l2res.json() as { sales: Array<{ id: string }> };
    expect(l2body.sales.find((s) => s.id === sfId)).toBeUndefined();
  });

  it('sale-detail: L2 without viewAll can read a storefront sale but not another cashier\'s pos sale', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, ['pos.sale.create', 'pos.history.view', 'pos.history.viewAll']);
    const slug = await enableStorefront(ctx.clientId);
    const [pid] = await seedProducts(ctx.clientId, [{ name: 'Det', sale_price_cents: 4000, status: 'active' }]);
    const sfId = await makeStorefrontSale(slug, pid!, '10.3.0.2');

    // An in-store pos sale created by the L1 owner.
    const posRes = await createPos(makeBucketUserRequest(ctx, 'POST', '/api/pos/sales', {
      channel: 'instore', idempotencyKey: `idem-${Math.random().toString(36).slice(2, 12)}`,
      customer: { name: 'Walk In', phone: '9008887776' }, lines: [{ productId: pid, qty: 1 }],
    }));
    const posId = (await posRes.json() as { id: string }).id;

    const l2 = await seedL2(ctx, ['pos.history.view']);
    const sf = await detailHandler(makeBucketUserRequest(l2, 'GET', `/api/pos/sales/${sfId}`));
    expect(sf.status).toBe(200);
    expect((await sf.json() as { source: string }).source).toBe('storefront');

    const pos = await detailHandler(makeBucketUserRequest(l2, 'GET', `/api/pos/sales/${posId}`));
    expect(pos.status).toBe(404); // own-only still applies to pos sales
  });
});
