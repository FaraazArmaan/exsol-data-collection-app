import { describe, it, expect, beforeAll } from 'vitest';
import { upsertCustomer } from '../../netlify/functions/_booking-customer-upsert';
import { sqlClient, seedClientWithBooking, seedCustomerRole } from './_helpers';

const sql = sqlClient();
let clientId: string;
beforeAll(async () => { const c = await seedClientWithBooking(); clientId = c.clientId; await seedCustomerRole(clientId); });

describe('upsertCustomer', () => {
  it('creates a node the first time, reuses it on the same phone', async () => {
    const a = await upsertCustomer(sql, clientId, { name: 'Riya', phone: '98765 43210', email: 'riya@example.com' });
    expect(a.wasCreated).toBe(true);
    const b = await upsertCustomer(sql, clientId, { name: 'Riya R', phone: '+91 98765 43210' }); // same normalized phone
    expect(b.wasCreated).toBe(false);
    expect(b.userNodeId).toBe(a.userNodeId);
  });

  it('matches on email too', async () => {
    const a = await upsertCustomer(sql, clientId, { name: 'Sam', phone: '90000 00001', email: 'sam@example.com' });
    const b = await upsertCustomer(sql, clientId, { name: 'Sam', phone: '90000 99999', email: 'SAM@example.com' });
    expect(b.userNodeId).toBe(a.userNodeId);
  });

  it('creates a distinct node for a new phone+email', async () => {
    const a = await upsertCustomer(sql, clientId, { name: 'New', phone: '91111 11111' });
    expect(a.wasCreated).toBe(true);
  });

  it('throws no_customer_role when the tenant has no customers-bucket role', async () => {
    const fresh = await seedClientWithBooking(); // no seedCustomerRole
    await expect(upsertCustomer(sql, fresh.clientId, { name: 'X', phone: '92222 22222' }))
      .rejects.toThrow('no_customer_role');
  });
});
