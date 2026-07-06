import { describe, it, expect } from 'vitest';
import suppliersHandler from '../../netlify/functions/procurement-suppliers';
import detailHandler from '../../netlify/functions/procurement-supplier-detail';
import { makeBucketUserRequest } from '../pos/_helpers';
import { seedProcurementClient, seedSupplier } from './_helpers';

interface SupplierRow { id: string; name: string }

describe('suppliers CRUD', () => {
  it('400 name_required when creating without a name', async () => {
    const ctx = await seedProcurementClient();
    const res = await suppliersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/suppliers', { phone: '1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('name_required');
  });

  it('creates then lists a supplier', async () => {
    const ctx = await seedProcurementClient();
    const c = await suppliersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/suppliers', { name: 'Acme', phone: '999' }));
    expect(c.status).toBe(201);
    const list = await suppliersHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/suppliers'));
    const rows = (await list.json()).suppliers as SupplierRow[];
    expect(rows.some((s) => s.name === 'Acme')).toBe(true);
  });

  it('updates a supplier', async () => {
    const ctx = await seedProcurementClient();
    const id = await seedSupplier(ctx, 'Old Name');
    const res = await detailHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/procurement/suppliers/${id}`, { name: 'New Name' }));
    expect(res.status).toBe(200);
    expect((await res.json()).supplier.name).toBe('New Name');
  });

  it('soft-deletes a supplier (hidden from the list)', async () => {
    const ctx = await seedProcurementClient();
    const id = await seedSupplier(ctx, 'Gone');
    const del = await detailHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/procurement/suppliers/${id}`));
    expect(del.status).toBe(200);
    const list = await suppliersHandler(makeBucketUserRequest(ctx, 'GET', '/api/procurement/suppliers'));
    const rows = (await list.json()).suppliers as SupplierRow[];
    expect(rows.some((s) => s.id === id)).toBe(false);
  });

  it('404 updating a supplier owned by another client', async () => {
    const ctx = await seedProcurementClient();
    const other = await seedProcurementClient();
    const foreignId = await seedSupplier(other, 'Foreign');
    const res = await detailHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/procurement/suppliers/${foreignId}`, { name: 'X' }));
    expect(res.status).toBe(404);
  });
});
