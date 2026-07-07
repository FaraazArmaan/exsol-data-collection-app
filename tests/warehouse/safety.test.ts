import { describe, it, expect } from 'vitest';
import incidentsHandler from '../../netlify/functions/warehouse-safety-incidents';
import incidentHandler from '../../netlify/functions/warehouse-safety-incident';
import checklistsHandler from '../../netlify/functions/warehouse-safety-checklists';
import signoffHandler from '../../netlify/functions/warehouse-safety-signoff';
import { makeBucketUserRequest, seedClientWithProductsEnabled } from '../pos/_helpers';
import { seedWarehouseClient, randName } from './_helpers';

type Ctx = Awaited<ReturnType<typeof seedWarehouseClient>>;
const listInc = (ctx: Ctx, qs = '') => incidentsHandler(makeBucketUserRequest(ctx, 'GET', `/api/warehouse/safety-incidents${qs}`));
const createInc = (ctx: Ctx, body: unknown) => incidentsHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/safety-incidents', body));
const patchInc = (ctx: Ctx, id: string, body: unknown) => incidentHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/warehouse/safety-incident/${id}`, body));
const delInc = (ctx: Ctx, id: string) => incidentHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/warehouse/safety-incident/${id}`));
const listChk = (ctx: Ctx) => checklistsHandler(makeBucketUserRequest(ctx, 'GET', '/api/warehouse/safety-checklists'));
const createChk = (ctx: Ctx, body: unknown) => checklistsHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/safety-checklists', body));
const signoff = (ctx: Ctx, body: unknown) => signoffHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/safety-signoff', body));

describe('warehouse safety — incidents', () => {
  it('creates an incident and lists it', async () => {
    const ctx = await seedWarehouseClient();
    const title = randName('Spill');
    const res = await createInc(ctx, { title, severity: 'high', description: 'Oil spill by the dock' });
    expect(res.status).toBe(201);
    const inc = (await res.json()).incident;
    expect(inc.severity).toBe('high');
    expect(inc.status).toBe('open');

    const listed = (await (await listInc(ctx, '?status=open')).json()).incidents as Array<{ id: string }>;
    expect(listed.map((i) => i.id)).toContain(inc.id);
  });

  it('400 title_required when blank', async () => {
    const ctx = await seedWarehouseClient();
    const res = await createInc(ctx, { title: '   ', severity: 'low' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('title_required');
  });

  it('400 severity_invalid for a bad severity', async () => {
    const ctx = await seedWarehouseClient();
    const res = await createInc(ctx, { title: randName(), severity: 'catastrophic' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('severity_invalid');
  });

  it('closes an incident via PATCH', async () => {
    const ctx = await seedWarehouseClient();
    const id = (await (await createInc(ctx, { title: randName(), severity: 'low' })).json()).incident.id;
    const res = await patchInc(ctx, id, { status: 'closed' });
    expect(res.status).toBe(200);
    expect((await res.json()).incident.status).toBe('closed');
  });

  it('404 PATCH of a foreign-client incident', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const foreignId = (await (await createInc(other, { title: randName(), severity: 'low' })).json()).incident.id;
    const res = await patchInc(ctx, foreignId, { status: 'closed' });
    expect(res.status).toBe(404);
  });

  it('deletes an incident', async () => {
    const ctx = await seedWarehouseClient();
    const id = (await (await createInc(ctx, { title: randName(), severity: 'low' })).json()).incident.id;
    expect((await delInc(ctx, id)).status).toBe(204);
    const listed = (await (await listInc(ctx, '?status=all')).json()).incidents as Array<{ id: string }>;
    expect(listed.map((i) => i.id)).not.toContain(id);
  });
});

describe('warehouse safety — checklists', () => {
  it('creates a checklist; a never-signed checklist is due', async () => {
    const ctx = await seedWarehouseClient();
    const title = randName('Daily check');
    const res = await createChk(ctx, { title, cadence: 'weekly' });
    expect(res.status).toBe(201);
    const chkId = (await res.json()).checklist.id;

    const items = (await (await listChk(ctx)).json()).checklists as Array<{ id: string; due: boolean; last_signed_at: string | null }>;
    const row = items.find((c) => c.id === chkId);
    expect(row?.due).toBe(true);
    expect(row?.last_signed_at).toBeNull();
  });

  it('signoff records completion and clears due', async () => {
    const ctx = await seedWarehouseClient();
    const chkId = (await (await createChk(ctx, { title: randName(), cadence: 'monthly' })).json()).checklist.id;
    const res = await signoff(ctx, { checklist_id: chkId, notes: 'All clear' });
    expect(res.status).toBe(200);

    const items = (await (await listChk(ctx)).json()).checklists as Array<{ id: string; due: boolean; last_signed_at: string | null }>;
    const row = items.find((c) => c.id === chkId);
    expect(row?.due).toBe(false);
    expect(row?.last_signed_at).not.toBeNull();
  });

  it('400 cadence_invalid for a bad cadence', async () => {
    const ctx = await seedWarehouseClient();
    const res = await createChk(ctx, { title: randName(), cadence: 'hourly' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('cadence_invalid');
  });

  it('404 signoff of a foreign-client checklist', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const foreignChk = (await (await createChk(other, { title: randName(), cadence: 'daily' })).json()).checklist.id;
    const res = await signoff(ctx, { checklist_id: foreignChk });
    expect(res.status).toBe(404);
  });
});

describe('warehouse safety — authz', () => {
  it('412 when warehouse not enabled', async () => {
    const bare = await seedClientWithProductsEnabled();
    expect((await listInc(bare)).status).toBe(412);
    expect((await listChk(bare)).status).toBe(412);
  });
});
