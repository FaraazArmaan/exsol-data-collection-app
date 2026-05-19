import { withTenantContext } from './tenancy.ts';
import { record as recordAudit } from './audit-log-writer.ts';
import type { ActorContext, MovementReason, MovementSource } from './types.ts';
import type { DbClient } from './db.ts';

export type MovementInput = {
  productId: string;
  delta: number;
  reason: MovementReason;
  source: MovementSource;
  note?: string;
  externalRef?: string;
  occurredAt?: Date;
};

export type Movement = {
  id: string;
  productId: string;
  delta: number;
  reason: MovementReason;
  source: MovementSource;
  note: string | null;
  occurredAt: Date;
  actorId: string;
  onBehalfOf: string | null;
};

const VALID_REASONS: ReadonlySet<MovementReason> = new Set([
  'purchase',
  'sale',
  'damage',
  'recount',
  'manual_adjust',
]);
const VALID_SOURCES: ReadonlySet<MovementSource> = new Set([
  'manual',
  'csv',
  'recount',
]);

export type RecordMovementError =
  | { error: 'zero_delta' }
  | { error: 'non_integer_delta' }
  | { error: 'invalid_reason' }
  | { error: 'invalid_source' }
  | { error: 'product_not_found' };

export async function recordMovement(
  actor: ActorContext,
  input: MovementInput,
  client?: DbClient,
): Promise<Movement | RecordMovementError> {
  if (!actor.workspaceId) throw new Error('actor.workspaceId is required');
  if (!Number.isInteger(input.delta)) return { error: 'non_integer_delta' };
  if (input.delta === 0) return { error: 'zero_delta' };
  if (!VALID_REASONS.has(input.reason)) return { error: 'invalid_reason' };
  if (!VALID_SOURCES.has(input.source)) return { error: 'invalid_source' };

  const runInTx = async (c: DbClient): Promise<Movement | RecordMovementError> => {
    const exists = await c.query(
      `SELECT 1 FROM products WHERE id = $1`,
      [input.productId],
    );
    if ((exists.rowCount ?? 0) === 0) return { error: 'product_not_found' };

    const r = await c.query(
      `INSERT INTO stock_movements (
         workspace_id, product_id, delta, reason, source,
         external_ref, actor_id, on_behalf_of, note, occurred_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10::timestamptz, now()))
       RETURNING id, product_id, delta, reason, source, note, occurred_at, actor_id, on_behalf_of`,
      [
        actor.workspaceId,
        input.productId,
        input.delta,
        input.reason,
        input.source,
        input.externalRef ?? null,
        actor.onBehalfOfId ?? actor.realActorId,
        actor.isImpersonating ? actor.realActorId : null,
        input.note ?? null,
        input.occurredAt ?? null,
      ],
    );
    const row = r.rows[0];

    await recordAudit(
      {
        realActorId: actor.realActorId,
        onBehalfOfId: actor.onBehalfOfId ?? null,
        impersonationReason: actor.impersonationReason,
        workspaceId: actor.workspaceId,
        action: 'stock.movement',
        resourceType: 'stock_movement',
        resourceId: row.id,
        metadata: {
          product_id: input.productId,
          delta: input.delta,
          reason: input.reason,
          source: input.source,
        },
      },
      c,
    );

    return {
      id: row.id,
      productId: row.product_id,
      delta: row.delta,
      reason: row.reason,
      source: row.source,
      note: row.note,
      occurredAt: row.occurred_at,
      actorId: row.actor_id,
      onBehalfOf: row.on_behalf_of,
    };
  };

  if (client) return runInTx(client);
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    runInTx,
  );
}

export async function currentCount(
  userId: string,
  workspaceId: string,
  productId: string,
): Promise<number | null> {
  return withTenantContext({ userId, workspaceId }, async (c) => {
    const r = await c.query(
      `SELECT stock_count FROM products WHERE id = $1`,
      [productId],
    );
    if ((r.rowCount ?? 0) === 0) return null;
    return r.rows[0].stock_count as number;
  });
}

export type RecountResult =
  | { kind: 'no_change' }
  | { kind: 'recorded'; movement: Movement }
  | { kind: 'error'; error: RecordMovementError['error'] };

export async function recountToAbsolute(
  actor: ActorContext,
  productId: string,
  absoluteCount: number,
  note?: string,
): Promise<RecountResult> {
  if (!actor.workspaceId) throw new Error('actor.workspaceId is required');
  if (!Number.isInteger(absoluteCount) || absoluteCount < 0) {
    return { kind: 'error', error: 'non_integer_delta' };
  }

  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const cur = await c.query(
        `SELECT stock_count FROM products WHERE id = $1`,
        [productId],
      );
      if ((cur.rowCount ?? 0) === 0) {
        return { kind: 'error' as const, error: 'product_not_found' as const };
      }

      const before = cur.rows[0].stock_count as number;
      const delta = absoluteCount - before;
      if (delta === 0) return { kind: 'no_change' as const };

      const result = await recordMovement(
        actor,
        { productId, delta, reason: 'recount', source: 'recount', note },
        c,
      );
      if ('error' in result) return { kind: 'error' as const, error: result.error };
      return { kind: 'recorded' as const, movement: result };
    },
  );
}
