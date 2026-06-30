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

  it('auto-creates a customers-bucket role when the tenant has none', async () => {
    const fresh = await seedClientWithBooking(); // no seedCustomerRole
    const r = await upsertCustomer(sql, fresh.clientId, { name: 'X', phone: '92222 22222' });
    expect(r.wasCreated).toBe(true);
    const role = (await sql`
      SELECT cr.bucket_family FROM public.user_nodes un
      JOIN public.client_roles cr ON cr.id = un.role_id WHERE un.id = ${r.userNodeId}::uuid
    `) as Array<{ bucket_family: string }>;
    expect(role[0]!.bucket_family).toBe('customers');
  });

  it('reuses the lazily-created role on the next new guest (no duplicate role)', async () => {
    const fresh = await seedClientWithBooking();
    await upsertCustomer(sql, fresh.clientId, { name: 'A', phone: '93000 00001' });
    await upsertCustomer(sql, fresh.clientId, { name: 'B', phone: '93000 00002' });
    const roles = (await sql`
      SELECT count(*)::int AS n FROM public.client_roles
      WHERE client_id = ${fresh.clientId}::uuid AND bucket_family = 'customers'
    `) as Array<{ n: number }>;
    expect(roles[0]!.n).toBe(1);
  });
});
