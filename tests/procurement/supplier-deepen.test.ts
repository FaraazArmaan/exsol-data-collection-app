import { describe, it, expect } from 'vitest';
import suppliersHandler from '../../netlify/functions/procurement-suppliers';
import detailHandler from '../../netlify/functions/procurement-supplier-detail';
import contactsHandler from '../../netlify/functions/procurement-supplier-contacts';
import contactDetailHandler from '../../netlify/functions/procurement-supplier-contact-detail';
import { seedProcurementClient, seedSupplier } from './_helpers';
import { makeBucketUserRequest } from '../pos/_helpers';

describe('procurement supplier deepen', () => {
  it('creates a supplier with payment_terms + rating', async () => {
    const ctx = await seedProcurementClient();
    const res = await suppliersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/suppliers', {
      name: 'Acme', payment_terms: 'Net 30', rating: 4,
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.supplier.payment_terms).toBe('Net 30');
    expect(body.supplier.rating).toBe(4);
  });

  it('400 for an out-of-range rating', async () => {
    const ctx = await seedProcurementClient();
    const res = await suppliersHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/suppliers', { name: 'Acme', rating: 9 }));
    expect(res.status).toBe(400);
  });

  it('updates payment_terms + rating', async () => {
    const ctx = await seedProcurementClient();
    const id = await seedSupplier(ctx, 'S');
    const res = await detailHandler(makeBucketUserRequest(ctx, 'PATCH', `/api/procurement/suppliers/${id}`, {
      name: 'S', payment_terms: 'Net 15', rating: 5,
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).supplier.rating).toBe(5);
  });

  it('adds, lists and removes supplier contacts', async () => {
    const ctx = await seedProcurementClient();
    const id = await seedSupplier(ctx, 'S');
    const c = await contactsHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/supplier-contacts', {
      supplier_id: id, name: 'Jane', role: 'Accounts', phone: '999',
    }));
    expect(c.status).toBe(201);
    const contactId = (await c.json()).contact.id;

    const list = await contactsHandler(makeBucketUserRequest(ctx, 'GET', `/api/procurement/supplier-contacts?supplier_id=${id}`));
    expect((await list.json()).contacts.length).toBe(1);

    const del = await contactDetailHandler(makeBucketUserRequest(ctx, 'DELETE', `/api/procurement/supplier-contacts/${contactId}`));
    expect(del.status).toBe(200);

    const list2 = await contactsHandler(makeBucketUserRequest(ctx, 'GET', `/api/procurement/supplier-contacts?supplier_id=${id}`));
    expect((await list2.json()).contacts.length).toBe(0);
  });

  it('404 adding a contact to a supplier owned by another client', async () => {
    const ctx = await seedProcurementClient();
    const other = await seedProcurementClient();
    const foreignSup = await seedSupplier(other, 'Foreign');
    const res = await contactsHandler(makeBucketUserRequest(ctx, 'POST', '/api/procurement/supplier-contacts', {
      supplier_id: foreignSup, name: 'X',
    }));
    expect(res.status).toBe(404);
  });
});
