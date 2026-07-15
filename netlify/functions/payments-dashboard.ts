import { jsonOk } from './_shared/http';
import { requirePayments } from './_payments-authz';

export const config = { path: '/api/payments/dashboard', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const auth = await requirePayments(req, ['payments.customers.view']);
  if (!auth.ok) return auth.res;
  return jsonOk({
    status: 'foundation',
    message: 'Cash receipts are available internally. Online collection remains off until webhook verification is complete.',
    capabilities: { cashReceipts: true, onlineCollection: false, refunds: false, reconciliation: false },
  });
}
