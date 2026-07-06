import { db } from './_shared/db';
import { requireCrm } from './_crm-authz';
import { refreshCustomers } from '../../src/modules/crm/lib/refresh';

export const config = { path: '/api/crm/refresh', method: 'POST' };

export default async function handler(req: Request): Promise<Response> {
  const a = await requireCrm(req, ['crm.customers.view']);
  if (!a.ok) return a.res;
  const synced = await refreshCustomers(db(), a.ctx.clientId);
  return new Response(JSON.stringify({ synced }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
