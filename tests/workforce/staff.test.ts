import { describe, it, expect } from 'vitest';
import staffHandler from '../../netlify/functions/workforce-staff';
import { seedWorkforceClient, makeBucketUserRequest } from './_helpers';

const list = (ctx: Awaited<ReturnType<typeof seedWorkforceClient>>) =>
  staffHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/staff'));

describe('workforce-staff', () => {
  it('lists booking_resources with team_members array', async () => {
    const ctx = await seedWorkforceClient();
    const res = await list(ctx);
    expect(res.status).toBe(200);
    const body = await res.json() as { resources: Array<{ id: string; team_members: unknown[] }> };
    const found = body.resources.find((r) => r.id === ctx.resourceId);
    expect(found).toBeDefined();
    expect(Array.isArray(found!.team_members)).toBe(true);
  });

  it('405 on POST', async () => {
    const ctx = await seedWorkforceClient();
    const res = await staffHandler(makeBucketUserRequest(ctx, 'POST', '/api/workforce/staff'));
    expect(res.status).toBe(405);
  });

  it('401 without auth', async () => {
    const res = await staffHandler(new Request('http://localhost/api/workforce/staff'));
    expect(res.status).toBe(401);
  });

  it('412 when workforce product not enabled', async () => {
    // Use a base POS context that has products+pos but NOT workforce enabled.
    const { seedClientWithProductsEnabled } = await import('../pos/_helpers');
    const ctx = await seedClientWithProductsEnabled();
    const res = await staffHandler(makeBucketUserRequest(ctx, 'GET', '/api/workforce/staff'));
    expect(res.status).toBe(412);
    expect((await res.json() as { error: { code: string } }).error.code).toBe('workforce_module_not_enabled');
  });
});
