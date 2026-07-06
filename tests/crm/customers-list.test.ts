import { describe, it, expect } from 'vitest';
import listHandler from '../../netlify/functions/crm-customers-list';
import refreshHandler from '../../netlify/functions/crm-refresh';
import { seedClientWithCrm, enableCrm, seedCustomerRole, seedCustomerNode, crmRequest, sqlClient } from './_helpers';

const sql = sqlClient();
const uniq = () => Math.random().toString(36).slice(2, 8);

async function seedTwoCustomers() {
  const ctx = await seedClientWithCrm();
  await enableCrm(ctx.clientId);
  const roleId = await seedCustomerRole(ctx.clientId);
  await seedCustomerNode(ctx.clientId, roleId, 'Aisha Khan', `98${uniq().padEnd(8,'0').slice(0,8)}`, `aisha-${uniq()}@x.com`);
  await seedCustomerNode(ctx.clientId, roleId, 'Bob Ray', `97${uniq().padEnd(8,'0').slice(0,8)}`, `bob-${uniq()}@x.com`);
  await refreshHandler(crmRequest(ctx, 'POST', '/api/crm/refresh'));
  return ctx;
}

describe('GET /api/crm/customers', () => {
  it('lists refreshed customers', async () => {
    const ctx = await seedTwoCustomers();
    const res = await listHandler(crmRequest(ctx, 'GET', '/api/crm/customers'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customers.length).toBe(2);
  });

  it('filters by ?q= on name/phone/email', async () => {
    const ctx = await seedTwoCustomers();
    const res = await listHandler(crmRequest(ctx, 'GET', '/api/crm/customers?q=aisha'));
    const body = await res.json();
    expect(body.customers.length).toBe(1);
    expect(body.customers[0].display_name).toContain('Aisha');
  });

  it('401 unauthenticated', async () => {
    const res = await listHandler(new Request('http://localhost/api/crm/customers'));
    expect(res.status).toBe(401);
  });
});
