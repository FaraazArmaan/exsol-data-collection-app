import { describe, it, expect } from 'vitest';
import handler from '../../netlify/functions/supply-chain-brief';
import {
  seedClientWithProductsEnabled, grantPerms, seedSubordinateUser, makeBucketUserRequest,
} from '../pos/_helpers';
import { enableSupplyChain } from './_helpers';

describe('GET /api/supply-chain-brief', () => {
  it('returns 200 with a non-empty brief string and fallback:true (no API key in CI)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-brief'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.brief).toBe('string');
    expect(body.brief.length).toBeGreaterThan(0);
    expect(body.fallback).toBe(true);
    expect(typeof body.generatedAt).toBe('string');
  });

  it('response includes a model field', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-brief'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.model).toBe('string');
    expect(body.model.length).toBeGreaterThan(0);
  });

  it('returns 200 even when the client has no supply-chain data (all aggregates are 0)', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    await grantPerms(ctx.clientId, 1, []);

    // No inventory, POs, production orders, or CO2 factors seeded
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-brief'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.brief).toBeTruthy();
    expect(body.fallback).toBe(true);
  });

  it('is 403 when a sub-user has no view permission', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await enableSupplyChain(ctx);
    const sub = await seedSubordinateUser(ctx, 2, []);
    const res = await handler(makeBucketUserRequest(sub, 'GET', '/api/supply-chain-brief'));
    expect(res.status).toBe(403);
  });

  it('is 412 when the supply-chain module is not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    await grantPerms(ctx.clientId, 1, []);
    const res = await handler(makeBucketUserRequest(ctx, 'GET', '/api/supply-chain-brief'));
    expect(res.status).toBe(412);
  });
});
