import { describe, it, expect, beforeAll } from 'vitest';
import assetsHandler from '../../netlify/functions/workforce-assets';
import assetHandler from '../../netlify/functions/workforce-asset';
import assignmentsHandler from '../../netlify/functions/workforce-asset-assignments';
import { seedWorkforceClient } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
beforeAll(async () => { ctx = await seedWorkforceClient(); });

function makeReq(method: string, url: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

describe('workforce assets', () => {
  let assetId: string;
  let assignmentId: string;

  it('POST creates an asset', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/assets', {
      name: `Laptop ${Date.now()}`,
      serial_number: `SN-${Date.now()}`,
      condition: 'good',
    }, ctx.cookie);
    const res = await assetsHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { asset: { id: string; condition: string } };
    expect(data.asset.condition).toBe('good');
    assetId = data.asset.id;
  });

  it('POST 400 without name', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/assets', {
      serial_number: 'SN-001',
    }, ctx.cookie);
    const res = await assetsHandler(req);
    expect(res.status).toBe(400);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('name_required');
  });

  it('GET lists assets (excludes retired by default)', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/assets', undefined, ctx.cookie);
    const res = await assetsHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { assets: Array<{ condition: string }> };
    expect(Array.isArray(data.assets)).toBe(true);
    expect(data.assets.every(a => a.condition !== 'retired')).toBe(true);
  });

  it('PATCH updates asset condition', async () => {
    const req = makeReq('PATCH', `http://localhost/api/workforce/asset/${assetId}`, {
      condition: 'fair',
    }, ctx.cookie);
    const res = await assetHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { asset: { condition: string } };
    expect(data.asset.condition).toBe('fair');
  });

  it('PATCH 404 for unknown asset', async () => {
    const req = makeReq('PATCH', 'http://localhost/api/workforce/asset/00000000-0000-0000-0000-000000000000', {
      condition: 'good',
    }, ctx.cookie);
    const res = await assetHandler(req);
    expect(res.status).toBe(404);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('asset_not_found');
  });

  it('POST assigns asset to user_node', async () => {
    // ctx.userNodeId is the L1 owner user_node in this client — valid for assignment.
    const req = makeReq('POST', 'http://localhost/api/workforce/asset-assignments', {
      asset_id: assetId,
      user_node_id: ctx.userNodeId,
      notes: 'Test assignment',
    }, ctx.cookie);
    const res = await assignmentsHandler(req);
    expect(res.status).toBe(201);
    const data = await res.json() as { assignment: { id: string; asset_id: string; user_node_id: string } };
    expect(data.assignment.asset_id).toBe(assetId);
    expect(data.assignment.user_node_id).toBe(ctx.userNodeId);
    assignmentId = data.assignment.id;
  });

  it('POST 409 double-assign same asset', async () => {
    const req = makeReq('POST', 'http://localhost/api/workforce/asset-assignments', {
      asset_id: assetId,
      user_node_id: ctx.userNodeId,
    }, ctx.cookie);
    const res = await assignmentsHandler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('asset_already_assigned');
  });

  it('GET lists assignments (active only)', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/asset-assignments?active=true', undefined, ctx.cookie);
    const res = await assignmentsHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { assignments: Array<{ id: string; returned_at: string | null }> };
    expect(Array.isArray(data.assignments)).toBe(true);
    expect(data.assignments.some(a => a.id === assignmentId)).toBe(true);
    expect(data.assignments.every(a => a.returned_at === null)).toBe(true);
  });

  it('GET asset now shows as assigned', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/assets', undefined, ctx.cookie);
    const res = await assetsHandler(req);
    const data = await res.json() as { assets: Array<{ id: string; current_assignment_id: string | null }> };
    const found = data.assets.find(a => a.id === assetId);
    expect(found?.current_assignment_id).toBe(assignmentId);
  });

  it('PATCH returns assignment', async () => {
    const req = makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
      assignment_id: assignmentId,
      condition_at_return: 'good',
      notes: 'Returned in good condition',
    }, ctx.cookie);
    const res = await assignmentsHandler(req);
    expect(res.status).toBe(200);
    const data = await res.json() as { assignment: { returned_at: string | null; condition_at_return: string | null } };
    expect(data.assignment.returned_at).not.toBeNull();
    expect(data.assignment.condition_at_return).toBe('good');
  });

  it('PATCH 409 double-return same assignment', async () => {
    const req = makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
      assignment_id: assignmentId,
    }, ctx.cookie);
    const res = await assignmentsHandler(req);
    expect(res.status).toBe(409);
    const data = await res.json() as { error: { code: string } };
    expect(data.error.code).toBe('already_returned');
  });

  it('DELETE retires asset (soft delete)', async () => {
    // Create a fresh asset for retirement test.
    const createReq = makeReq('POST', 'http://localhost/api/workforce/assets', {
      name: `Retire Test Asset ${Date.now()}`,
    }, ctx.cookie);
    const createRes = await assetsHandler(createReq);
    const { asset } = await createRes.json() as { asset: { id: string } };

    const retireReq = makeReq('DELETE', `http://localhost/api/workforce/asset/${asset.id}`, undefined, ctx.cookie);
    const retireRes = await assetHandler(retireReq);
    expect(retireRes.status).toBe(204);

    // Verify excluded from default list.
    const listReq = makeReq('GET', 'http://localhost/api/workforce/assets', undefined, ctx.cookie);
    const listRes = await assetsHandler(listReq);
    const { assets } = await listRes.json() as { assets: Array<{ id: string }> };
    expect(assets.find(a => a.id === asset.id)).toBeUndefined();

    // Verify shows up with condition=retired filter.
    const retiredReq = makeReq('GET', 'http://localhost/api/workforce/assets?condition=retired', undefined, ctx.cookie);
    const retiredRes = await assetsHandler(retiredReq);
    const retiredData = await retiredRes.json() as { assets: Array<{ id: string; condition: string }> };
    const retiredAsset = retiredData.assets.find(a => a.id === asset.id);
    expect(retiredAsset?.condition).toBe('retired');
  });

  it('GET 401 without auth (assets)', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/assets');
    const res = await assetsHandler(req);
    expect(res.status).toBe(401);
  });

  it('GET 401 without auth (assignments)', async () => {
    const req = makeReq('GET', 'http://localhost/api/workforce/asset-assignments');
    const res = await assignmentsHandler(req);
    expect(res.status).toBe(401);
  });

  it('GET 405 on unsupported method (assets)', async () => {
    const req = makeReq('DELETE', 'http://localhost/api/workforce/assets', undefined, ctx.cookie);
    const res = await assetsHandler(req);
    expect(res.status).toBe(405);
  });
});
