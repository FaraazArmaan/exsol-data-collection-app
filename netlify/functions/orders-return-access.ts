import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';
import { db } from './_shared/db';
import { ordersAuditSession, requireOrders } from './_orders-authz';
import { issueReturnAccessToken, revokeReturnAccessToken } from './_orders-return-access';

export const config = { path: '/api/orders/returns/access', method: ['POST', 'DELETE'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req: Request): Promise<Response> {
  const a = await requireOrders(req, ['orders.business.create']);
  if (!a.ok) return a.res;
  let body: { sale_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const saleId = typeof body?.sale_id === 'string' ? body.sale_id : '';
  if (!UUID.test(saleId)) return jsonError(400, 'invalid_body');

  if (req.method === 'POST') {
    const issued = await issueReturnAccessToken(a.ctx, saleId);
    if (!issued) return jsonError(404, 'not_found');
    await logAudit(db(), {
      session: ordersAuditSession(a.ctx),
      op: 'orders.return_access.issued',
      clientId: a.ctx.clientId,
      targetType: 'sale',
      targetId: saleId,
    });
    return jsonOk(
      { return_access_token: issued.token, expires_at: issued.expiresAt },
      { status: 201 },
    );
  }
  if (req.method === 'DELETE') {
    if (!(await revokeReturnAccessToken(a.ctx, saleId))) return jsonError(404, 'not_found');
    await logAudit(db(), {
      session: ordersAuditSession(a.ctx),
      op: 'orders.return_access.revoked',
      clientId: a.ctx.clientId,
      targetType: 'sale',
      targetId: saleId,
    });
    return new Response(null, { status: 204 });
  }
  return new Response('Method Not Allowed', { status: 405 });
}
