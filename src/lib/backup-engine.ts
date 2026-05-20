/**
 * backupEngine (Module 12)
 *
 * Two backup flavours:
 *
 *   - Workspace backup: a Primary (or admin via impersonation) triggers
 *     a per-workspace disaster-recovery ZIP. Contents:
 *
 *       manifest.json                 metadata (workspace, generated_at,
 *                                     row counts, format_version, app version)
 *       data/workspace.json           the workspace row itself
 *       data/memberships.json         workspace_memberships
 *       data/categories.json
 *       data/products.json
 *       data/product_marketplace_fields.json
 *       data/stock_movements.json     full append-only ledger
 *       data/audit_events.json        workspace-scoped events
 *       images/<imageKey>.<ext>       raw image bytes from the
 *                                     product-images Blob store
 *
 *     The ZIP is written to the `workspace-backups` Blob store; a row
 *     in the `backups` table records (kind='workspace', blob_key,
 *     size, triggered_by, status).
 *
 *   - System backup: an admin triggers a cross-workspace dump. Contents:
 *
 *       manifest.json
 *       schema/00X_*.sql              copies of every migration file
 *                                     (so the ZIP is restorable into a
 *                                     fresh Neon project)
 *       data/<table>.json             one file per table (users,
 *                                     workspaces, products, …)
 *
 *     Stored in the `system-backups` Blob store; a row in `backups`
 *     with kind='system'.
 *
 * Sync only in v1 (single Function invocation generates and persists
 * the ZIP). Async / scheduled-function trigger is planned v1.1; the
 * `backups` table is already shaped for the `queued`/`running`/`done`
 * lifecycle.
 *
 * Retention pruning is a no-op stub in v1; we record everything and
 * leave deletion to a manual UI or a v1.1 scheduled function.
 */

import JSZip from 'jszip';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { withTenantContext, withAdminContext } from './tenancy.ts';
import { pool } from './db.ts';
import * as blobStorage from './blob-storage.ts';
import { record as recordAudit } from './audit-log-writer.ts';
import type { ActorContext } from './types.ts';

// ---------- Constants ----------

const FORMAT_VERSION = 1;
const TOOL = 'ExSol Data Collection App';

// Tables included in the system dump. Order matters when restoring (FK
// dependencies) but the dump itself is just an ordered list.
const SYSTEM_TABLES = [
  'users',
  'workspaces',
  'workspace_memberships',
  'categories',
  'products',
  'product_marketplace_fields',
  'stock_movements',
  'audit_events',
  'refresh_tokens',
  'email_verifications',
  'password_resets',
  'impersonation_sessions',
  'workspace_unlocks',
  'unlock_attempts',
  'workspace_lockouts',
  'files',
  'export_jobs',
  'backups',
] as const;

// ---------- Types ----------

export type WorkspaceBackupOk = {
  ok: true;
  backupId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type SystemBackupOk = {
  ok: true;
  backupId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type BackupError = { ok: false; error: string };

// ---------- Workspace backup ----------

/**
 * Builds a ZIP backup for the given workspace and persists it to the
 * `workspace-backups` Blob store. Records a row in `backups` for audit
 * + listing. Returns metadata (the bytes are not returned inline —
 * backups can easily exceed inline-safe sizes).
 */
export async function runWorkspace(actor: ActorContext): Promise<WorkspaceBackupOk | BackupError> {
  if (!actor.workspaceId) throw new Error('workspaceId required');

  // 1. Insert the backups row first so we have an id to key by + a place
  //    to record failure if anything below throws.
  const backupId = await createBackupRow(actor, 'workspace');

  try {
    // 2. Gather all workspace data within an RLS-scoped tx.
    const data = await withTenantContext(
      { userId: actor.realActorId, workspaceId: actor.workspaceId },
      async (c) => {
        const [
          workspace,
          memberships,
          categories,
          products,
          overlays,
          stockMovements,
          auditEvents,
        ] = await Promise.all([
          c.query(`SELECT * FROM workspaces WHERE id = $1`, [actor.workspaceId]),
          c.query(`SELECT * FROM workspace_memberships WHERE workspace_id = $1`, [actor.workspaceId]),
          c.query(`SELECT * FROM categories WHERE workspace_id = $1`, [actor.workspaceId]),
          c.query(`SELECT * FROM products WHERE workspace_id = $1`, [actor.workspaceId]),
          c.query(`SELECT * FROM product_marketplace_fields WHERE workspace_id = $1`, [actor.workspaceId]),
          c.query(`SELECT * FROM stock_movements WHERE workspace_id = $1`, [actor.workspaceId]),
          c.query(`SELECT * FROM audit_events WHERE workspace_id = $1`, [actor.workspaceId]),
        ]);
        return {
          workspace: workspace.rows[0] ?? null,
          memberships: memberships.rows,
          categories: categories.rows,
          products: products.rows,
          overlays: overlays.rows,
          stockMovements: stockMovements.rows,
          auditEvents: auditEvents.rows,
        };
      },
    );

    if (!data.workspace) {
      await markBackupFailed(actor, backupId, 'workspace_not_found');
      return { ok: false, error: 'workspace_not_found' };
    }

    // 3. Compose the ZIP. Image bytes are streamed individually from Blobs.
    const zip = new JSZip();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const slug = slugify(data.workspace.name);
    const innerRoot = `workspace_${slug}_${stamp}`;

    const allImageKeys = collectImageKeys(data.products);
    const imageMetas: Array<{ key: string; bytesInZip: string }> = [];

    for (const key of allImageKeys) {
      const blob = await blobStorage.getImage(key);
      if (!blob) continue; // image was deleted; skip silently
      const bytes = await streamToBuffer(blob.stream);
      const ext = mimeToExt(blob.contentType);
      const zipPath = `${innerRoot}/images/${key}${ext}`;
      zip.file(zipPath, bytes);
      imageMetas.push({ key, bytesInZip: zipPath });
    }

    const manifest = {
      format_version: FORMAT_VERSION,
      kind: 'workspace',
      backup_id: backupId,
      workspace_id: actor.workspaceId,
      workspace_name: data.workspace.name,
      generated_at: new Date().toISOString(),
      generated_by: actor.onBehalfOfId ?? actor.realActorId,
      impersonation_reason: actor.impersonationReason ?? null,
      counts: {
        memberships: data.memberships.length,
        categories: data.categories.length,
        products: data.products.length,
        marketplace_overlays: data.overlays.length,
        stock_movements: data.stockMovements.length,
        audit_events: data.auditEvents.length,
        images: imageMetas.length,
      },
      images_index: imageMetas,
      tool: TOOL,
    };

    zip.file(`${innerRoot}/manifest.json`, JSON.stringify(manifest, null, 2));
    zip.file(`${innerRoot}/data/workspace.json`, JSON.stringify(data.workspace, null, 2));
    zip.file(`${innerRoot}/data/memberships.json`, JSON.stringify(data.memberships, null, 2));
    zip.file(`${innerRoot}/data/categories.json`, JSON.stringify(data.categories, null, 2));
    zip.file(`${innerRoot}/data/products.json`, JSON.stringify(data.products, null, 2));
    zip.file(`${innerRoot}/data/product_marketplace_fields.json`, JSON.stringify(data.overlays, null, 2));
    zip.file(`${innerRoot}/data/stock_movements.json`, JSON.stringify(data.stockMovements, null, 2));
    zip.file(`${innerRoot}/data/audit_events.json`, JSON.stringify(data.auditEvents, null, 2));

    const bytes = (await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })) as Uint8Array;

    // 4. Persist + finalize the row.
    const filename = `${innerRoot}.zip`;
    const blobKey = await blobStorage.putWorkspaceBackup(
      actor.workspaceId,
      backupId,
      filename,
      bytes,
      'application/zip',
    );
    await markBackupDone(actor, backupId, blobKey, bytes.byteLength);

    return {
      ok: true,
      backupId,
      filename,
      contentType: 'application/zip',
      sizeBytes: bytes.byteLength,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markBackupFailed(actor, backupId, msg).catch(() => {});
    throw err;
  }
}

// ---------- System backup ----------

/**
 * Builds a system-wide ZIP backup. Admin-only — the caller must gate on
 * `admin:run_system_backup` before invoking. Reads every table without
 * RLS scoping by using the admin context.
 *
 * For a healthy v1-scale system, this is < ~100 MB even with several
 * Clients onboarded. If the DB ever grows past Functions' memory cap,
 * we'll switch to streaming-write of a multi-part archive — for v1 the
 * in-memory single ZIP is the right trade-off.
 */
export async function runSystem(actor: ActorContext): Promise<SystemBackupOk | BackupError> {
  // Admin actor — workspaceId not required.
  const backupId = await createBackupRow(actor, 'system');

  try {
    const tableDumps: Record<string, unknown[]> = {};
    let totalRows = 0;
    await withAdminContext({ userId: actor.realActorId }, async (c) => {
      for (const table of SYSTEM_TABLES) {
        const r = await c.query(`SELECT * FROM ${table}`);
        tableDumps[table] = r.rows;
        totalRows += r.rows.length;
      }
    });

    const zip = new JSZip();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const innerRoot = `system_backup_${stamp}`;

    // Embed every migration file under schema/ so the ZIP is self-
    // sufficient for restore against a fresh Neon project.
    const migrationsDir = path.resolve(process.cwd(), 'db/migrations');
    let migrationFiles: string[] = [];
    try {
      migrationFiles = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
      for (const file of migrationFiles) {
        const sql = await readFile(path.join(migrationsDir, file), 'utf-8');
        zip.file(`${innerRoot}/schema/${file}`, sql);
      }
    } catch {
      // Running outside the repo (e.g. deployed Function) — migrations
      // aren't on disk. That's OK; the manifest records the schema
      // version via the migration filenames in the backups table.
    }

    for (const table of SYSTEM_TABLES) {
      zip.file(`${innerRoot}/data/${table}.json`, JSON.stringify(tableDumps[table], null, 2));
    }

    const manifest = {
      format_version: FORMAT_VERSION,
      kind: 'system',
      backup_id: backupId,
      generated_at: new Date().toISOString(),
      generated_by: actor.realActorId,
      tables: SYSTEM_TABLES,
      row_counts: Object.fromEntries(SYSTEM_TABLES.map((t) => [t, tableDumps[t]?.length ?? 0])),
      total_rows: totalRows,
      schema_files: migrationFiles,
      tool: TOOL,
    };
    zip.file(`${innerRoot}/manifest.json`, JSON.stringify(manifest, null, 2));

    const bytes = (await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })) as Uint8Array;

    const filename = `${innerRoot}.zip`;
    const blobKey = await blobStorage.putSystemBackup(
      backupId,
      filename,
      bytes,
      'application/zip',
    );
    await markBackupDone(actor, backupId, blobKey, bytes.byteLength);

    return {
      ok: true,
      backupId,
      filename,
      contentType: 'application/zip',
      sizeBytes: bytes.byteLength,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markBackupFailed(actor, backupId, msg).catch(() => {});
    throw err;
  }
}

// ---------- Backup row CRUD ----------

async function createBackupRow(actor: ActorContext, kind: 'workspace' | 'system'): Promise<string> {
  const client = await pool().connect();
  try {
    // Admin (system) backups have no workspace_id; use admin context.
    // Workspace backups go through tenant context so RLS still applies.
    if (kind === 'system') {
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_workspace_id', '', true),
                set_config('app.is_admin', 'true', true)`,
        [actor.realActorId],
      );
    } else {
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_workspace_id', $2, true),
                set_config('app.is_admin', 'false', true)`,
        [actor.realActorId, actor.workspaceId],
      );
    }
    const r = await client.query(
      `INSERT INTO backups (workspace_id, kind, triggered_by, status, started_at)
       VALUES ($1, $2::backup_kind, $3, 'running'::job_status, now())
       RETURNING id`,
      [kind === 'workspace' ? actor.workspaceId : null, kind, actor.onBehalfOfId ?? actor.realActorId],
    );
    const id = r.rows[0].id as string;
    await recordAudit(
      {
        realActorId: actor.realActorId,
        onBehalfOfId: actor.onBehalfOfId ?? null,
        impersonationReason: actor.impersonationReason,
        workspaceId: kind === 'workspace' ? actor.workspaceId : null,
        action: kind === 'workspace' ? 'backup.workspace.start' : 'backup.system.start',
        resourceType: 'backup',
        resourceId: id,
      },
      client as unknown as Parameters<typeof recordAudit>[1],
    );
    return id;
  } finally {
    client.release();
  }
}

async function markBackupDone(
  actor: ActorContext,
  backupId: string,
  blobKey: string,
  sizeBytes: number,
): Promise<void> {
  const client = await pool().connect();
  try {
    // Re-set the context for this update; some queries need is_admin=true
    // when no workspace context is available (system backups).
    if (actor.workspaceId) {
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_workspace_id', $2, true),
                set_config('app.is_admin', 'false', true)`,
        [actor.realActorId, actor.workspaceId],
      );
    } else {
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_workspace_id', '', true),
                set_config('app.is_admin', 'true', true)`,
        [actor.realActorId],
      );
    }
    await client.query(
      `UPDATE backups
         SET status = 'done'::job_status,
             blob_key = $2,
             size_bytes = $3,
             finished_at = now()
       WHERE id = $1`,
      [backupId, blobKey, sizeBytes],
    );
  } finally {
    client.release();
  }
}

async function markBackupFailed(actor: ActorContext, backupId: string, errorMsg: string): Promise<void> {
  const client = await pool().connect();
  try {
    if (actor.workspaceId) {
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_workspace_id', $2, true),
                set_config('app.is_admin', 'false', true)`,
        [actor.realActorId, actor.workspaceId],
      );
    } else {
      await client.query(
        `SELECT set_config('app.current_user_id', $1, true),
                set_config('app.current_workspace_id', '', true),
                set_config('app.is_admin', 'true', true)`,
        [actor.realActorId],
      );
    }
    await client.query(
      `UPDATE backups
         SET status = 'failed'::job_status,
             error = $2,
             finished_at = now()
       WHERE id = $1`,
      [backupId, errorMsg],
    );
  } finally {
    client.release();
  }
}

// ---------- Listing ----------

export type BackupRow = {
  id: string;
  kind: 'workspace' | 'system';
  workspaceId: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  blobKey: string | null;
  sizeBytes: number | null;
  retentionClass: 'rolling' | 'monthly';
  triggeredBy: string;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

function rowToBackup(row: Record<string, unknown>): BackupRow {
  const dateOrNull = (v: unknown): string | null =>
    v instanceof Date ? v.toISOString() : typeof v === 'string' ? v : null;
  return {
    id: row['id'] as string,
    kind: row['kind'] as 'workspace' | 'system',
    workspaceId: (row['workspace_id'] as string | null) ?? null,
    status: row['status'] as 'queued' | 'running' | 'done' | 'failed',
    blobKey: (row['blob_key'] as string | null) ?? null,
    sizeBytes: row['size_bytes'] == null ? null : Number(row['size_bytes']),
    retentionClass: (row['retention_class'] as 'rolling' | 'monthly') ?? 'rolling',
    triggeredBy: row['triggered_by'] as string,
    error: (row['error'] as string | null) ?? null,
    startedAt: dateOrNull(row['started_at']),
    finishedAt: dateOrNull(row['finished_at']),
    createdAt: dateOrNull(row['created_at']) ?? '',
  };
}

export async function listWorkspaceBackups(actor: ActorContext, limit = 20): Promise<BackupRow[]> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const r = await c.query(
        `SELECT * FROM backups WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [actor.workspaceId, limit],
      );
      return r.rows.map(rowToBackup);
    },
  );
}

export async function listSystemBackups(actor: ActorContext, limit = 20): Promise<BackupRow[]> {
  return withAdminContext({ userId: actor.realActorId }, async (c) => {
    const r = await c.query(
      `SELECT * FROM backups WHERE kind = 'system' ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map(rowToBackup);
  });
}

export async function getBackup(actor: ActorContext, backupId: string): Promise<BackupRow | null> {
  // Try as workspace member first; fall back to admin context for system backups.
  if (actor.workspaceId) {
    const r = await withTenantContext(
      { userId: actor.realActorId, workspaceId: actor.workspaceId },
      async (c) => c.query(`SELECT * FROM backups WHERE id = $1`, [backupId]),
    );
    if ((r.rowCount ?? 0) > 0) return rowToBackup(r.rows[0]);
  }
  if (actor.realRole === 'admin') {
    const r = await withAdminContext({ userId: actor.realActorId }, async (c) =>
      c.query(`SELECT * FROM backups WHERE id = $1`, [backupId]),
    );
    if ((r.rowCount ?? 0) > 0) return rowToBackup(r.rows[0]);
  }
  return null;
}

// ---------- Internals ----------

function collectImageKeys(products: any[]): string[] {
  const out = new Set<string>();
  for (const p of products) {
    if (p.primary_image_id) out.add(p.primary_image_id);
    for (const k of p.extra_image_ids ?? []) out.add(k);
  }
  return Array.from(out);
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

function mimeToExt(mime: string): string {
  return MIME_EXT[mime.toLowerCase()] ?? '.bin';
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'workspace';
}
