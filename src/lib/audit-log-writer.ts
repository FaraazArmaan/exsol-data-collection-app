import { pool, type DbClient } from './db.ts';

type ActorIds = {
  realActorId: string;
  onBehalfOfId?: string | null;
  impersonationReason?: string | null;
};

type EventBase = {
  workspaceId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
};

type DiffEvent = EventBase & {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

type BulkEvent = EventBase & {
  bulkSummary: { count: number; sampleIds?: string[] };
};

export type AuditPayload = ActorIds & (DiffEvent | BulkEvent);

export async function record(payload: AuditPayload, client?: DbClient): Promise<void> {
  const c = client ?? ((await pool().connect()) as unknown as DbClient);
  const own = !client;
  try {
    let before: Record<string, unknown> | null = null;
    let after: Record<string, unknown> | null = null;
    if (!('bulkSummary' in payload)) {
      const diffed = diffChanges(payload.before, payload.after);
      before = diffed.before;
      after = diffed.after;
    }

    const metadata =
      'bulkSummary' in payload
        ? { ...(payload.metadata ?? {}), bulkSummary: payload.bulkSummary }
        : (payload.metadata ?? {});

    await c.query(
      `INSERT INTO audit_events (
        workspace_id, actor_user_id, on_behalf_of, impersonation_reason,
        action, resource_type, resource_id, before_data, after_data, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        payload.workspaceId ?? null,
        payload.realActorId,
        payload.onBehalfOfId ?? null,
        payload.impersonationReason ?? null,
        payload.action,
        payload.resourceType ?? null,
        payload.resourceId ?? null,
        before,
        after,
        metadata,
      ],
    );
  } finally {
    if (own) c.release();
  }
}

function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown> | null; after: Record<string, unknown> | null } {
  if (!before && !after) return { before: null, after: null };
  if (!before) return { before: null, after: after ?? null };
  if (!after) return { before: before ?? null, after: null };

  const cb: Record<string, unknown> = {};
  const ca: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (!isShallowEqual(before[k], after[k])) {
      cb[k] = before[k];
      ca[k] = after[k];
    }
  }
  if (Object.keys(cb).length === 0) return { before: null, after: null };
  return { before: cb, after: ca };
}

function isShallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}
