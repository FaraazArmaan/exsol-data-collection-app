import { describe, it, expect } from 'vitest';
import locationsHandler from '../../netlify/functions/warehouse-locations';
import locationHandler from '../../netlify/functions/warehouse-location';
import { makeBucketUserRequest, seedClientWithProductsEnabled } from '../pos/_helpers';
import { seedWarehouseClient, seedLocation, randName, enableWarehouse } from './_helpers';

const list = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>) =>
  locationsHandler(makeBucketUserRequest(ctx, 'GET', '/api/warehouse/locations'));
const create = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>, body: unknown) =>
  locationsHandler(makeBucketUserRequest(ctx, 'POST', '/api/warehouse/locations', body));
const patch = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>, id: string, body: unknown) =>
  locationHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/warehouse/location/${id}`, body));
const del = (ctx: Awaited<ReturnType<typeof seedWarehouseClient>>, id: string) =>
  locationHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/warehouse/location/${id}`));

describe('warehouse locations CRUD', () => {
  it('creates a location and lists it', async () => {
    const ctx = await seedWarehouseClient();
    const name = randName('Main');
    const res = await create(ctx, { name, kind: 'warehouse' });
    expect(res.status).toBe(201);
    const created = (await res.json()).location;
    expect(created.name).toBe(name);
    expect(created.kind).toBe('warehouse');

    const listed = (await (await list(ctx)).json()).locations as Array<{ id: string }>;
    expect(listed.map((l) => l.id)).toContain(created.id);
  });

  it('400 name_required when name is blank', async () => {
    const ctx = await seedWarehouseClient();
    const res = await create(ctx, { name: '  ', kind: 'store' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('name_required');
  });

  it('400 kind_invalid for an unknown kind', async () => {
    const ctx = await seedWarehouseClient();
    const res = await create(ctx, { name: randName(), kind: 'spaceship' });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('kind_invalid');
  });

  it('409 name_taken on a duplicate name within the client', async () => {
    const ctx = await seedWarehouseClient();
    const name = randName('Dup');
    expect((await create(ctx, { name })).status).toBe(201);
    const res = await create(ctx, { name });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('name_taken');
  });

  it('renames a location via PATCH', async () => {
    const ctx = await seedWarehouseClient();
    const id = await seedLocation(ctx, randName());
    const newName = randName('Renamed');
    const res = await patch(ctx, id, { name: newName });
    expect(res.status).toBe(200);
    expect((await res.json()).location.name).toBe(newName);
  });

  it('404 on PATCH of a location owned by another client', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const foreignId = await seedLocation(other, randName());
    const res = await patch(ctx, foreignId, { name: randName() });
    expect(res.status).toBe(404);
  });

  it('deletes a location via DELETE', async () => {
    const ctx = await seedWarehouseClient();
    const id = await seedLocation(ctx, randName());
    const res = await del(ctx, id);
    expect(res.status).toBe(204);
    const listed = (await (await list(ctx)).json()).locations as Array<{ id: string }>;
    expect(listed.map((l) => l.id)).not.toContain(id);
  });

  it('404 on DELETE of a foreign-client location', async () => {
    const ctx = await seedWarehouseClient();
    const other = await seedWarehouseClient();
    const foreignId = await seedLocation(other, randName());
    const res = await del(ctx, foreignId);
    expect(res.status).toBe(404);
  });

  it('412 create when warehouse product not enabled', async () => {
    const ctx = await seedClientWithProductsEnabled();
    const res = await create(ctx, { name: randName() });
    expect(res.status).toBe(412);
    // sanity: enabling then works
    await enableWarehouse(ctx);
    expect((await create(ctx, { name: randName() })).status).toBe(201);
  });
});
