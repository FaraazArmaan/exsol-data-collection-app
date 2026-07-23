// Public customer return timeline and initiation. The bearer token is tied to
// exactly one sale; this function never accepts a sale id, email, or phone as authority.

import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { resolveReturnAccessToken, type ReturnAccessGrant } from './_orders-return-access';
import { createOrdersReturnCase, type OrdersReturnCaseActor } from './_orders-return-cases';
import type { AnySession } from './_shared/permissions';

export const config = { path: '/api/public/returns', method: ['GET', 'POST'] };

type PublicReturnLine = {
  sale_line_id: string;
  qty: number;
  reason: string | null;
  inventory_receipt_state: 'not_received' | 'received';
  refund_state: string | null;
};

type PublicReturnCase = {
  return_case_id: string;
  status: string;
  created_at: string;
  lines: PublicReturnLine[];
  authorisation_message: string;
};

function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function message(status: string, refusalReason: string | null): string {
  if (status === 'refused')
    return refusalReason ? `Return request declined: ${refusalReason}` : 'Return request declined.';
  if (status === 'authorized' || status === 'awaiting_receipt')
    return 'Return request authorised. Please follow the return instructions.';
  if (status === 'closed') return 'Return case closed.';
  return 'Return request received.';
}

async function publicReturnCases(
  access: ReturnAccessGrant,
  caseId?: string,
): Promise<PublicReturnCase[]> {
  const sql = db();
  const cases = (await sql`
    SELECT id, status, created_at, refusal_reason
    FROM public.orders_return_cases
    WHERE client_id=${access.clientId}::uuid
      AND sale_id=${access.saleId}::uuid
      AND (${caseId ?? null}::uuid IS NULL OR id=${caseId ?? null}::uuid)
    ORDER BY created_at DESC
  `) as Array<{ id: string; status: string; created_at: string; refusal_reason: string | null }>;
  if (cases.length === 0) return [];
  const ids = cases.map((row) => row.id);
  const lines = (await sql`
    SELECT line.return_case_id, line.sale_line_id, line.qty, line.reason,
      CASE WHEN line.inventory_return_id IS NULL THEN 'not_received' ELSE 'received' END AS inventory_receipt_state,
      refund.state AS refund_state
    FROM public.orders_return_case_lines line
    LEFT JOIN public.orders_refunds refund ON refund.id=line.refund_id
    WHERE return_case_id=ANY(${ids}::uuid[])
    ORDER BY line.created_at ASC
  `) as Array<PublicReturnLine & { return_case_id: string }>;
  return cases.map((row) => ({
    return_case_id: row.id,
    status: row.status,
    created_at: row.created_at,
    lines: lines
      .filter((line) => line.return_case_id === row.id)
      .map(({ return_case_id: _caseId, ...line }) => line),
    authorisation_message: message(row.status, row.refusal_reason),
  }));
}

function publicActor(access: ReturnAccessGrant): OrdersReturnCaseActor {
  return {
    clientId: access.clientId,
    userNodeId: null,
    // Public storefront requests intentionally have no staff identity; logAudit
    // records both actor columns as NULL for this recognised non-user actor.
    auditSession: { kind: 'storefront' } as unknown as AnySession,
    source: 'storefront',
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405 });

  const rl = await checkLimit(clientIp(req), 'orders-return', { perMinute: 30 });
  if (!rl.ok) return jsonError(429, rl.code);

  if (req.method === 'GET') {
    const access = await resolveReturnAccessToken(bearerToken(req));
    if (!access) return jsonError(404, 'not_found');
    return jsonOk({ return_cases: await publicReturnCases(access) });
  }

  const raw = await req.json().catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return jsonError(400, 'invalid_body');
  const body = raw as {
    return_access_token?: unknown;
    idempotency_key?: unknown;
    reason?: unknown;
    lines?: unknown;
  };
  const token = typeof body.return_access_token === 'string' ? body.return_access_token : '';
  const access = await resolveReturnAccessToken(token);
  if (!access) return jsonError(404, 'not_found');
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : '';
  const result = await createOrdersReturnCase(publicActor(access), {
    sale_id: access.saleId,
    idempotency_key: `public-return:${access.id}:${idempotencyKey}`,
    reason: body.reason,
    lines: body.lines,
  });
  if (!result.ok) {
    if (result.code === 'sale_line_not_found') return jsonError(404, 'not_found');
    return jsonError(result.status, result.code);
  }
  const cases = await publicReturnCases(access, result.returnCase.id as string);
  if (!cases[0]) throw new Error('public_return_case_projection_missing');
  return jsonOk(cases[0], { status: result.created ? 201 : 200 });
}
