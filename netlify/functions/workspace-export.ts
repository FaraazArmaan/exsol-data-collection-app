// GET /api/workspace-export?format=json|zip
//
// Per-client snapshot of workspace data — users, structure, files metadata,
// products metadata. JSON or ZIP-of-CSVs. Gated by _platform.workspace.view
// (with L1 Owner bypass). Writes one workspace.exported audit row before
// streaming.
//
// Spec: docs/superpowers/specs/2026-06-11-workspace-export-design.md

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import {
  authenticateForPermission,
  adminHasCapability,
  resolveClientIdOrRespond,
  type AnySession,
} from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { ExportTooLargeError } from './_shared/exporters/types';
import { collectWorkspaceSnapshot } from './_shared/workspace-export-collect';
import { toJsonResponse, toZipResponse } from './_shared/workspace-export-format';
import { countTables, type ExportActor } from './_shared/workspace-export-types';

function isFormat(v: string | null): v is 'json' | 'zip' {
  return v === 'json' || v === 'zip';
}

async function actorFor(session: AnySession, sql: ReturnType<typeof db>): Promise<ExportActor> {
  if (session.kind === 'admin') {
    return { kind: 'admin', id: session.admin.id, email: session.admin.email };
  }
  // bucket_user — fetch email from credentials by user_node_id.
  const rows = (await sql`
    SELECT email FROM public.user_node_credentials
    WHERE user_node_id = ${session.user_node_id}::uuid
    LIMIT 1
  `) as { email: string }[];
  return {
    kind: 'user_node',
    id: session.user_node_id,
    // Defensive fallback: a deleted credential row leaves the JWT still
    // valid for a short window. Logging the user_node_id (with a marker)
    // is more honest in audit history than a silent empty string.
    email: rows[0]?.email ?? `<user_node:${session.user_node_id}>`,
  };
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');

  const url = new URL(req.url);
  const formatParam = url.searchParams.get('format');
  if (!isFormat(formatParam)) return jsonError(400, 'invalid_format');
  const format: 'json' | 'zip' = formatParam;

  const auth = await authenticateForPermission(req, '_platform.workspace.view');
  if (auth instanceof Response) return auth;
  const session = auth;
  if (session.kind === 'admin' && !adminHasCapability(session.admin, 'workspace.export')) {
    return jsonError(403, 'admin_role_forbidden', { capability: 'workspace.export' });
  }

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const sql = db();

  // Look up slug for the filename + audit detail.
  const clientRows = (await sql`
    SELECT slug FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as { slug: string }[];
  if (clientRows.length === 0) return jsonError(404, 'client_not_found');
  const slug = clientRows[0]!.slug;

  const actor = await actorFor(session, sql);

  let snapshot;
  try {
    snapshot = await collectWorkspaceSnapshot(sql, clientId, actor);
  } catch (e) {
    console.error('[workspace-export] collect failed', (e as Error).message);
    return jsonError(500, 'internal_error');
  }

  let response: Response;
  try {
    response = format === 'json'
      ? toJsonResponse(snapshot, slug)
      : await toZipResponse(snapshot, slug);
  } catch (e) {
    if (e instanceof ExportTooLargeError) {
      return jsonError(413, 'export_too_large', { size_bytes: e.sizeBytes, limit_bytes: e.limit });
    }
    console.error('[workspace-export] format failed', (e as Error).message);
    return jsonError(500, 'internal_error');
  }

  // Audit on success only (failures self-log to stderr above).
  const byteCount =
    response.headers.get('content-length')
      ? Number(response.headers.get('content-length'))
      : 0;
  await logAudit(sql, {
    session,
    op: 'workspace.exported',
    clientId,
    targetType: 'workspace',
    targetId: clientId,
    detail: {
      format,
      byte_count: byteCount,
      table_counts: countTables(snapshot),
    },
  });

  return response;
};
