// Characterization tests for workforce-asset-assignments — pins the exact
// behavior of every GET filter combination and every PATCH field combination
// BEFORE the branch-collapse refactor (cleanup-2 theme T6). If the collapse
// changes any observable behavior, these go red.
import { describe, it, expect, beforeAll } from 'vitest';
import assetsHandler from '../../netlify/functions/workforce-assets';
import assignmentsHandler from '../../netlify/functions/workforce-asset-assignments';
import { seedWorkforceClient, seedSecondNode } from './_helpers';

let ctx: Awaited<ReturnType<typeof seedWorkforceClient>>;
let nodeA: string; // owner node
let nodeB: string; // second node
let assetA: string;
let assetB: string;
let returnedAssignmentId: string; // nodeA×assetA, returned
let activeAssignmentId: string;   // nodeB×assetB, active

function makeReq(method: string, url: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cookie) headers['cookie'] = cookie;
  return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function createAsset(name: string): Promise<string> {
  const res = await assetsHandler(makeReq('POST', 'http://localhost/api/workforce/assets', {
    name, condition: 'good',
  }, ctx.cookie));
  expect(res.status).toBe(201);
  return ((await res.json()) as { asset: { id: string } }).asset.id;
}

async function assign(assetId: string, userNodeId: string, notes?: string): Promise<string> {
  const res = await assignmentsHandler(makeReq('POST', 'http://localhost/api/workforce/asset-assignments', {
    asset_id: assetId, user_node_id: userNodeId, ...(notes !== undefined ? { notes } : {}),
  }, ctx.cookie));
  expect(res.status).toBe(201);
  return ((await res.json()) as { assignment: { id: string } }).assignment.id;
}

async function listAssignments(qs: string): Promise<Array<{ id: string; asset_id: string; user_node_id: string; returned_at: string | null; notes: string | null; condition_at_return: string | null }>> {
  const res = await assignmentsHandler(makeReq('GET', `http://localhost/api/workforce/asset-assignments${qs}`, undefined, ctx.cookie));
  expect(res.status).toBe(200);
  return ((await res.json()) as { assignments: Array<{ id: string; asset_id: string; user_node_id: string; returned_at: string | null; notes: string | null; condition_at_return: string | null }> }).assignments;
}

beforeAll(async () => {
  ctx = await seedWorkforceClient();
  nodeA = ctx.userNodeId;
  nodeB = await seedSecondNode(ctx);
  assetA = await createAsset(`Char-A ${Math.random().toString(36).slice(2, 8)}`);
  assetB = await createAsset(`Char-B ${Math.random().toString(36).slice(2, 8)}`);
  // nodeA×assetA assigned WITH notes, then returned (bare PATCH — both fields null)
  returnedAssignmentId = await assign(assetA, nodeA, 'char notes');
  const ret = await assignmentsHandler(makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
    assignment_id: returnedAssignmentId,
  }, ctx.cookie));
  expect(ret.status).toBe(200);
  // nodeB×assetB active, no notes
  activeAssignmentId = await assign(assetB, nodeB);
});

describe('GET /api/workforce/asset-assignments — all filter combinations', () => {
  it('no filters → both assignments', async () => {
    const rows = await listAssignments('');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(returnedAssignmentId);
    expect(ids).toContain(activeAssignmentId);
  });

  it('user_node_id filter → only that node', async () => {
    const rows = await listAssignments(`?user_node_id=${nodeA}`);
    expect(rows.some((r) => r.id === returnedAssignmentId)).toBe(true);
    expect(rows.every((r) => r.user_node_id === nodeA)).toBe(true);
  });

  it('asset_id filter → only that asset', async () => {
    const rows = await listAssignments(`?asset_id=${assetB}`);
    expect(rows.some((r) => r.id === activeAssignmentId)).toBe(true);
    expect(rows.every((r) => r.asset_id === assetB)).toBe(true);
  });

  it('user_node_id + asset_id → intersection', async () => {
    const rows = await listAssignments(`?user_node_id=${nodeA}&asset_id=${assetA}`);
    expect(rows.map((r) => r.id)).toContain(returnedAssignmentId);
    expect(rows.every((r) => r.user_node_id === nodeA && r.asset_id === assetA)).toBe(true);
    const cross = await listAssignments(`?user_node_id=${nodeA}&asset_id=${assetB}`);
    expect(cross.length).toBe(0);
  });

  it('active=true → excludes returned', async () => {
    const rows = await listAssignments('?active=true');
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(activeAssignmentId);
    expect(ids).not.toContain(returnedAssignmentId);
    expect(rows.every((r) => r.returned_at === null)).toBe(true);
  });

  it('active=true + user_node_id → active for that node only', async () => {
    expect((await listAssignments(`?active=true&user_node_id=${nodeB}`)).map((r) => r.id)).toContain(activeAssignmentId);
    expect((await listAssignments(`?active=true&user_node_id=${nodeA}`)).map((r) => r.id)).not.toContain(returnedAssignmentId);
  });

  it('active=true + asset_id → active for that asset only', async () => {
    expect((await listAssignments(`?active=true&asset_id=${assetB}`)).map((r) => r.id)).toContain(activeAssignmentId);
    expect((await listAssignments(`?active=true&asset_id=${assetA}`)).length).toBe(0);
  });

  it('active=true + both filters', async () => {
    expect((await listAssignments(`?active=true&user_node_id=${nodeB}&asset_id=${assetB}`)).map((r) => r.id)).toContain(activeAssignmentId);
    expect((await listAssignments(`?active=true&user_node_id=${nodeA}&asset_id=${assetA}`)).length).toBe(0);
  });
});

describe('POST — notes handling + 404s', () => {
  it('notes persisted when provided; NULL when omitted (schema default)', async () => {
    // NB: check the 201 body — the beforeAll bare-return later nulls assetA's
    // notes (that branch behavior is pinned in the PATCH suite below).
    const asset = await createAsset(`Char-N ${Math.random().toString(36).slice(2, 8)}`);
    const res = await assignmentsHandler(makeReq('POST', 'http://localhost/api/workforce/asset-assignments', {
      asset_id: asset, user_node_id: nodeA, notes: 'posted notes',
    }, ctx.cookie));
    expect(res.status).toBe(201);
    expect(((await res.json()) as { assignment: { notes: string | null } }).assignment.notes).toBe('posted notes');
    const withoutNotes = (await listAssignments(`?asset_id=${assetB}`)).find((r) => r.id === activeAssignmentId);
    expect(withoutNotes?.notes).toBeNull();
  });

  it('404 asset_not_found / user_node_not_found', async () => {
    const ghost = '00000000-0000-4000-8000-000000000001';
    const r1 = await assignmentsHandler(makeReq('POST', 'http://localhost/api/workforce/asset-assignments', {
      asset_id: ghost, user_node_id: nodeA,
    }, ctx.cookie));
    expect(r1.status).toBe(404);
    expect(((await r1.json()) as { error: { code: string } }).error.code).toBe('asset_not_found');
    const r2 = await assignmentsHandler(makeReq('POST', 'http://localhost/api/workforce/asset-assignments', {
      asset_id: assetA, user_node_id: ghost,
    }, ctx.cookie));
    expect(r2.status).toBe(404);
    expect(((await r2.json()) as { error: { code: string } }).error.code).toBe('user_node_not_found');
  });
});

describe('PATCH — every field combination', () => {
  // Each case gets a fresh assignment on its own asset so 409s can't leak between cases.
  async function freshAssignment(): Promise<string> {
    const asset = await createAsset(`Char-P ${Math.random().toString(36).slice(2, 8)}`);
    return assign(asset, nodeA);
  }

  it('bare return → returned_at set, condition + notes NULL', async () => {
    const rows = (await listAssignments('')).find((r) => r.id === returnedAssignmentId)!;
    expect(rows.returned_at).not.toBeNull();
    expect(rows.condition_at_return).toBeNull();
    // notes stay from POST — the bare PATCH branch writes notes=NULL:
    expect(rows.notes).toBeNull();
  });

  it('condition only → notes NULL', async () => {
    const id = await freshAssignment();
    const res = await assignmentsHandler(makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
      assignment_id: id, condition_at_return: 'fair',
    }, ctx.cookie));
    expect(res.status).toBe(200);
    const a = ((await res.json()) as { assignment: { condition_at_return: string | null; notes: string | null; returned_at: string | null } }).assignment;
    expect(a.condition_at_return).toBe('fair');
    expect(a.notes).toBeNull();
    expect(a.returned_at).not.toBeNull();
  });

  it('notes only → condition NULL', async () => {
    const id = await freshAssignment();
    const res = await assignmentsHandler(makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
      assignment_id: id, notes: 'returned at desk',
    }, ctx.cookie));
    expect(res.status).toBe(200);
    const a = ((await res.json()) as { assignment: { condition_at_return: string | null; notes: string | null } }).assignment;
    expect(a.condition_at_return).toBeNull();
    expect(a.notes).toBe('returned at desk');
  });

  it('condition + notes → both set', async () => {
    const id = await freshAssignment();
    const res = await assignmentsHandler(makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
      assignment_id: id, condition_at_return: 'poor', notes: 'scratched',
    }, ctx.cookie));
    expect(res.status).toBe(200);
    const a = ((await res.json()) as { assignment: { condition_at_return: string | null; notes: string | null } }).assignment;
    expect(a.condition_at_return).toBe('poor');
    expect(a.notes).toBe('scratched');
  });

  it('400 invalid_condition_at_return', async () => {
    const id = await freshAssignment();
    const res = await assignmentsHandler(makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
      assignment_id: id, condition_at_return: 'destroyed',
    }, ctx.cookie));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_condition_at_return');
  });

  it('404 assignment_not_found', async () => {
    const res = await assignmentsHandler(makeReq('PATCH', 'http://localhost/api/workforce/asset-assignments', {
      assignment_id: '00000000-0000-4000-8000-000000000002',
    }, ctx.cookie));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('assignment_not_found');
  });
});
