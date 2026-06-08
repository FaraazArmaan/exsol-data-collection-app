// POST /api/u-products-bulk
//
// Payload shape mirrors user-nodes-bulk:
//   { ids: string[], action: 'set_status', value: 'active'|'draft'|'archived' }
//   { ids: string[], action: 'set_category', category_id: string|null }
//   { ids: string[], action: 'delete' }
//
// Permission gate per action:
//   set_status, set_category → products.products.edit
//   delete                   → products.products.delete
//
// Returns { ok: id[], errors: { id, code }[] } — ids not owned by caller's
// client surface as 'not_found' rather than 403, mirroring the existing bulk
// pattern (the caller doesn't get to learn about other clients' rows).

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond, type AnySession } from './_shared/permissions';
import { logAudit } from './_shared/audit';

const MAX_BULK = 200;

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    ids:    z.array(z.string().uuid()).min(1).max(MAX_BULK),
    value:  z.enum(['active', 'draft', 'archived']),
  }),
  z.object({
    action:      z.literal('set_category'),
    ids:         z.array(z.string().uuid()).min(1).max(MAX_BULK),
    category_id: z.string().uuid().nullable(),
  }),
  z.object({
    action: z.literal('delete'),
    ids:    z.array(z.string().uuid()).min(1).max(MAX_BULK),
  }),
]);

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const raw = await req.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const body = parsed.data;

  const requiredFlag = body.action === 'delete' ? 'products.products.delete' : 'products.products.edit';
  const auth = await authenticateForPermission(req, requiredFlag);
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const sql = db();

  // Resolve ownership: which IDs actually belong to caller's client + are live?
  const owned = (await sql`
    SELECT id FROM public.products
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
      AND id = ANY(${body.ids}::uuid[])
  `) as Array<{ id: string }>;
  const ownedSet = new Set(owned.map((r) => r.id));
  const missing  = body.ids.filter((id) => !ownedSet.has(id));
  const ids = Array.from(ownedSet);

  if (ids.length > 0) {
    if (body.action === 'set_status') {
      await sql`
        UPDATE public.products
        SET status = ${body.value}::product_status, updated_at = now()
        WHERE client_id = ${clientId}::uuid AND id = ANY(${ids}::uuid[])
      `;
      await Promise.all(ids.map((id) => logAudit(sql, {
        session, op: 'products.status_changed',
        clientId, targetType: 'product', targetId: id,
        detail: { to: body.value, bulk: true },
      })));
    } else if (body.action === 'set_category') {
      await sql`
        UPDATE public.products
        SET category_id = ${body.category_id}::uuid, updated_at = now()
        WHERE client_id = ${clientId}::uuid AND id = ANY(${ids}::uuid[])
      `;
      await Promise.all(ids.map((id) => logAudit(sql, {
        session, op: 'products.category_changed',
        clientId, targetType: 'product', targetId: id,
        detail: { to: body.category_id, bulk: true },
      })));
    } else { // delete
      await sql`
        UPDATE public.products
        SET deleted_at = now()
        WHERE client_id = ${clientId}::uuid AND id = ANY(${ids}::uuid[])
      `;
      await Promise.all(ids.map((id) => logAudit(sql, {
        session, op: 'products.archived',
        clientId, targetType: 'product', targetId: id,
        detail: { bulk: true },
      })));
    }
  }

  return jsonOk({
    ok: ids,
    errors: missing.map((id) => ({ id, code: 'not_found' })),
  });
};

// (silence unused import warning if we ever shake it; AnySession is brought in
// transitively by `session` but the explicit import documents intent.)
type _S = AnySession;
