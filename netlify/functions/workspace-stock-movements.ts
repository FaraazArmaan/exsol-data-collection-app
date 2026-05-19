import type { Context } from '@netlify/functions';
import { resolveWorkspaceActor } from '../../src/lib/workspace-actor.ts';
import { can } from '../../src/lib/permissions.ts';
import {
  recordMovement,
  recountToAbsolute,
} from '../../src/lib/stock-ledger.ts';
import { json, methodNotAllowed, readJson } from '../../src/lib/http.ts';
import type { MovementReason, MovementSource } from '../../src/lib/types.ts';

export const config = { path: '/api/workspaces/:wsid/stock/movements' };

type Body = {
  productId?: unknown;
  delta?: unknown;
  absoluteCount?: unknown;
  reason?: unknown;
  source?: unknown;
  note?: unknown;
};

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== 'POST') return methodNotAllowed();
  const workspaceId = context.params?.wsid;
  if (!workspaceId) return json({ error: 'missing_workspace_id' }, 400);

  const resolved = await resolveWorkspaceActor(req, workspaceId);
  if (resolved instanceof Response) return resolved;
  const { actor } = resolved;

  if (!can(actor, 'stock:write', { type: 'stock_movement', workspaceId })) {
    return json({ error: 'forbidden' }, 403);
  }

  const body = await readJson<Body>(req);
  if (!body) return json({ error: 'invalid_json' }, 400);

  if (typeof body.productId !== 'string') {
    return json({ error: 'missing_productId' }, 400);
  }

  if (typeof body.absoluteCount === 'number') {
    const r = await recountToAbsolute(
      actor,
      body.productId,
      body.absoluteCount,
      typeof body.note === 'string' ? body.note : undefined,
    );
    if (r.kind === 'error') {
      return json({ error: r.error }, r.error === 'product_not_found' ? 404 : 400);
    }
    if (r.kind === 'no_change') return json({ kind: 'no_change' });
    return json({ kind: 'recorded', movement: r.movement });
  }

  if (typeof body.delta !== 'number') {
    return json({ error: 'missing_delta_or_absoluteCount' }, 400);
  }

  const result = await recordMovement(actor, {
    productId: body.productId,
    delta: body.delta,
    reason: body.reason as MovementReason,
    source: (typeof body.source === 'string'
      ? body.source
      : 'manual') as MovementSource,
    note: typeof body.note === 'string' ? body.note : undefined,
  });
  if ('error' in result) {
    return json(result, result.error === 'product_not_found' ? 404 : 400);
  }
  return json({ movement: result });
};
