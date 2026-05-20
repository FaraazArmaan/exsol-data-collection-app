/**
 * exportEngine (Module 11)
 *
 * Generates catalog exports in three profiles:
 *   - xlsx_comprehensive  : all core fields + per-marketplace overlay JSON, .xlsx via exceljs
 *   - csv_comprehensive   : same columns, .csv via papaparse
 *   - meta_catalog_csv    : Meta Commerce / WhatsApp Business catalog schema
 *
 * Dispatch:
 *   v1 ships SYNC ONLY. The PRD specifies a sync vs async split at 500
 *   rows / 2 MB; we implement the threshold as a hard ceiling instead
 *   of an async fallback because the Scheduled-Functions worker isn't
 *   built yet. Above the ceiling, callers get a `too_large` error with
 *   a hint to apply a filter. The async pipeline is a planned v1.1
 *   extension — the export_jobs table is already shaped for it.
 *
 * Every export is recorded as a row in `export_jobs` (status = 'done'
 * on success, 'failed' on error). This gives the workspace an audit
 * trail of who exported what, when, and the Blobs key of the result.
 *
 * Generated files are persisted to the `product-exports` Blob store.
 * The download endpoint streams from there; bytes never round-trip
 * through the function in the response path.
 */

import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import JSZip from 'jszip';
import { withTenantContext } from './tenancy.ts';
import { listProducts } from './product-service.ts';
import * as blobStorage from './blob-storage.ts';
import { record as recordAudit } from './audit-log-writer.ts';
import type { ActorContext, Marketplace, ProductStatus } from './types.ts';

// ---------- Types ----------

export type ExportProfile = 'xlsx_comprehensive' | 'csv_comprehensive' | 'meta_catalog_csv';

export type ExportFilter = {
  search?: string;
  status?: ProductStatus | null;
  categoryId?: string;
  marketplaceEnabled?: Marketplace;
};

/**
 * Maximum row count for the sync path. Above this the engine refuses
 * with `too_large` and a hint. Picked to keep peak XLSX-build memory
 * under ~80 MB (rough rule of thumb: exceljs allocates ~150 KB per row
 * for medium-width sheets, and Netlify Functions have a 1 GB memory
 * cap that's shared with the rest of the runtime).
 */
const SYNC_ROW_CEILING = 500;

export type RunOk = {
  ok: true;
  jobId: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type RunError =
  | { ok: false; error: 'too_large'; rowCount: number; ceiling: number }
  | { ok: false; error: 'no_rows' }
  | { ok: false; error: 'invalid_profile' };

export type RunResult = RunOk | RunError;

// ---------- Top-level entry point ----------

/**
 * Runs an export end-to-end:
 *   1. Inserts an `export_jobs` row with status='running'.
 *   2. Counts matching products; bails with `too_large` if over ceiling.
 *   3. Loads the rows via listProducts (respects RLS via tenant context).
 *   4. Generates the file bytes per profile.
 *   5. Stores bytes in the `product-exports` Blob store, keyed by job id.
 *   6. Updates the job row to status='done' with the blob_key + finished_at.
 *   7. Returns the bytes inline so the caller can also stream to the user
 *      without a second round-trip for tiny exports.
 *
 * On failure inside steps 2-5, marks the job 'failed' with the error
 * message and rethrows. The job row provides the audit trail either way.
 */
export async function run(params: {
  actor: ActorContext;
  profile: ExportProfile;
  filter?: ExportFilter;
}): Promise<RunResult> {
  const { actor, profile, filter = {} } = params;
  if (!actor.workspaceId) throw new Error('workspaceId required');

  if (!isValidProfile(profile)) return { ok: false, error: 'invalid_profile' };

  const jobId = await createJobRow(actor, profile, filter);

  try {
    // Load (RLS-scoped). Use a generous limit; we then enforce the sync
    // ceiling explicitly so the caller gets a clean error instead of a
    // truncated file.
    const result = await listProducts(actor, { ...filter, limit: SYNC_ROW_CEILING + 1 });

    if (result.products.length === 0) {
      await markFailed(actor, jobId, 'no_rows');
      return { ok: false, error: 'no_rows' };
    }
    if (result.total > SYNC_ROW_CEILING) {
      await markFailed(actor, jobId, `too_large: ${result.total} > ${SYNC_ROW_CEILING}`);
      return { ok: false, error: 'too_large', rowCount: result.total, ceiling: SYNC_ROW_CEILING };
    }

    const inner = await buildInner(profile, result.products, actor.workspaceId);
    const zipped = await wrapInZip(profile, inner, {
      rowCount: result.products.length,
      workspaceId: actor.workspaceId,
      filter,
      requesterId: actor.onBehalfOfId ?? actor.realActorId,
    });
    const blobKey = await blobStorage.putExport(
      actor.workspaceId,
      jobId,
      zipped.filename,
      zipped.bytes,
      zipped.contentType,
    );
    await markDone(actor, jobId, blobKey);

    return {
      ok: true,
      jobId,
      filename: zipped.filename,
      contentType: zipped.contentType,
      bytes: zipped.bytes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markFailed(actor, jobId, msg).catch(() => {}); // best-effort
    throw err;
  }
}

// ---------- Job row CRUD ----------

async function createJobRow(
  actor: ActorContext,
  profile: ExportProfile,
  filter: ExportFilter,
): Promise<string> {
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId! },
    async (c) => {
      const r = await c.query(
        `INSERT INTO export_jobs (workspace_id, requester_id, profile, filter, status, started_at)
         VALUES ($1, $2, $3::export_profile, $4::jsonb, 'running'::job_status, now())
         RETURNING id`,
        [
          actor.workspaceId,
          actor.onBehalfOfId ?? actor.realActorId,
          profile,
          JSON.stringify(filter),
        ],
      );
      const id = r.rows[0].id as string;
      await recordAudit(
        {
          realActorId: actor.realActorId,
          onBehalfOfId: actor.onBehalfOfId ?? null,
          impersonationReason: actor.impersonationReason,
          workspaceId: actor.workspaceId,
          action: 'export.start',
          resourceType: 'export_job',
          resourceId: id,
          after: { profile, filter },
        },
        c,
      );
      return id;
    },
  );
}

async function markDone(actor: ActorContext, jobId: string, blobKey: string): Promise<void> {
  await withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId! },
    async (c) => {
      await c.query(
        `UPDATE export_jobs
           SET status = 'done'::job_status,
               blob_key = $2,
               finished_at = now()
         WHERE id = $1`,
        [jobId, blobKey],
      );
    },
  );
}

async function markFailed(actor: ActorContext, jobId: string, errorMsg: string): Promise<void> {
  await withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId! },
    async (c) => {
      await c.query(
        `UPDATE export_jobs
           SET status = 'failed'::job_status,
               error = $2,
               finished_at = now()
         WHERE id = $1`,
        [jobId, errorMsg],
      );
    },
  );
}

// ---------- File generation ----------

type Built = { filename: string; contentType: string; bytes: Uint8Array };

/**
 * Builds the raw catalog file for the requested profile (xlsx or csv).
 * The caller wraps this in `wrapInZip` to produce the final downloadable
 * artifact — ZIP wrapping is uniform across profiles so the download
 * surface ("you get a .zip with the catalog file + a manifest") is
 * predictable for downstream consumers.
 */
async function buildInner(
  profile: ExportProfile,
  rows: Awaited<ReturnType<typeof listProducts>>['products'],
  workspaceId: string,
): Promise<Built> {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  switch (profile) {
    case 'xlsx_comprehensive':
      return buildXlsxComprehensive(rows, `catalog_${stamp}.xlsx`);
    case 'csv_comprehensive':
      return buildCsvComprehensive(rows, `catalog_${stamp}.csv`);
    case 'meta_catalog_csv':
      return buildMetaCatalogCsv(rows, workspaceId, `meta_catalog_${stamp}.csv`);
  }
}

/**
 * Wraps an inner catalog file in a ZIP that also carries a manifest.json
 * with the export's metadata. Standardising on ZIP gives us a single
 * download shape across all profiles, room to bundle ancillary data later
 * (image-attachments, per-marketplace overlay JSONs, etc.) without
 * changing the download UX, and DEFLATE compression that meaningfully
 * shrinks the CSV cases (XLSX is already a ZIP under the hood so the
 * outer wrap is near no-op on size — but still uniform).
 *
 * The outer filename keeps a hint of the inner format
 * (`catalog_<date>_xlsx.zip`) so a user receiving multiple exports can
 * tell them apart without opening each.
 */
async function wrapInZip(
  profile: ExportProfile,
  inner: Built,
  meta: { rowCount: number; workspaceId: string; filter: ExportFilter; requesterId: string },
): Promise<Built> {
  const zip = new JSZip();
  zip.file(inner.filename, inner.bytes);
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        format_version: 1,
        profile,
        inner_filename: inner.filename,
        inner_content_type: inner.contentType,
        filter: meta.filter,
        row_count: meta.rowCount,
        generated_at: new Date().toISOString(),
        workspace_id: meta.workspaceId,
        requester_id: meta.requesterId,
        tool: 'ExSol Data Collection App',
      },
      null,
      2,
    ),
  );

  const bytes = (await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })) as Uint8Array;

  // catalog_20260520.xlsx → catalog_20260520_xlsx.zip
  const outer = inner.filename.replace(/\.([a-z0-9]+)$/i, '_$1.zip');
  return { filename: outer, contentType: 'application/zip', bytes };
}

/** Column set used by both comprehensive profiles. Single source of truth. */
const COMPREHENSIVE_COLUMNS: Array<{ key: string; header: string; map: (p: any) => unknown }> = [
  { key: 'sku', header: 'SKU', map: (p) => p.sku },
  { key: 'name', header: 'Name', map: (p) => p.name },
  { key: 'description', header: 'Description', map: (p) => p.description ?? '' },
  { key: 'product_type', header: 'Product type', map: (p) => p.productType },
  { key: 'status', header: 'Status', map: (p) => p.status },
  { key: 'price', header: 'Price', map: (p) => p.price },
  { key: 'currency', header: 'Currency', map: (p) => p.currency },
  { key: 'cost', header: 'Cost', map: (p) => p.cost ?? '' },
  { key: 'stock_count', header: 'Stock', map: (p) => p.stockCount },
  { key: 'stock_unit', header: 'Stock unit', map: (p) => p.stockUnit ?? '' },
  { key: 'weight_g', header: 'Weight (g)', map: (p) => p.weightG ?? '' },
  { key: 'dim_l_mm', header: 'Length (mm)', map: (p) => p.dimLMm ?? '' },
  { key: 'dim_w_mm', header: 'Width (mm)', map: (p) => p.dimWMm ?? '' },
  { key: 'dim_h_mm', header: 'Height (mm)', map: (p) => p.dimHMm ?? '' },
  { key: 'barcode', header: 'Barcode', map: (p) => p.barcode ?? '' },
  { key: 'hsn_code', header: 'HSN', map: (p) => p.hsnCode ?? '' },
  { key: 'gst_rate', header: 'GST %', map: (p) => p.gstRate ?? '' },
  { key: 'tags', header: 'Tags', map: (p) => (p.tags ?? []).join(', ') },
  { key: 'low_stock_threshold', header: 'Low-stock threshold', map: (p) => p.lowStockThreshold ?? '' },
  { key: 'dead_stock_days', header: 'Dead-stock days', map: (p) => p.deadStockDays ?? '' },
  { key: 'food_fields', header: 'Food fields (JSON)', map: (p) => p.foodFields ? JSON.stringify(p.foodFields) : '' },
  { key: 'primary_image_id', header: 'Primary image key', map: (p) => p.primaryImageId ?? '' },
  { key: 'extra_image_ids', header: 'Extra image keys', map: (p) => (p.extraImageIds ?? []).join(' | ') },
  { key: 'created_at', header: 'Created', map: (p) => p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt },
  { key: 'updated_at', header: 'Updated', map: (p) => p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt },
];

async function buildXlsxComprehensive(rows: unknown[], filename: string): Promise<Built> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ExSol Data Collection App';
  wb.created = new Date();
  const ws = wb.addWorksheet('Products');
  ws.columns = COMPREHENSIVE_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: 20,
  }));
  for (const row of rows) {
    const obj: Record<string, unknown> = {};
    for (const c of COMPREHENSIVE_COLUMNS) obj[c.key] = c.map(row);
    ws.addRow(obj);
  }
  // Header row formatting
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };

  const buf = await wb.xlsx.writeBuffer();
  return {
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    bytes: new Uint8Array(buf),
  };
}

function buildCsvComprehensive(rows: unknown[], filename: string): Built {
  const data = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of COMPREHENSIVE_COLUMNS) out[c.header] = c.map(row);
    return out;
  });
  const csv = Papa.unparse(data, {
    header: true,
    columns: COMPREHENSIVE_COLUMNS.map((c) => c.header),
    quotes: true,
  });
  return {
    filename,
    contentType: 'text/csv; charset=utf-8',
    bytes: new TextEncoder().encode(csv),
  };
}

/**
 * Meta Commerce / WhatsApp Business catalog schema. Columns are
 * positional and named per Meta's spec
 * (https://www.facebook.com/business/help/120325381656392).
 *
 * `link` and `image_link` need to be absolute URLs. Uses APP_BASE_URL
 * as the public host. In production this should be the deployed app's
 * domain; in localhost dev it'll be http://localhost:8888 (which Meta
 * won't accept, but the CSV is still well-formed for inspection).
 */
function buildMetaCatalogCsv(
  rows: any[],
  workspaceId: string,
  filename: string,
): Built {
  const appBase = (process.env['APP_BASE_URL'] ?? 'http://localhost:8888').replace(/\/$/, '');
  const data = rows.map((p) => ({
    id: p.sku,
    title: p.name,
    description: p.description ?? p.name,
    availability: p.stockCount > 0 ? 'in stock' : 'out of stock',
    condition: 'new',
    price: `${Number(p.price).toFixed(2)} ${p.currency || 'INR'}`,
    link: `${appBase}/product-edit.html?wsid=${workspaceId}&pid=${p.id}`,
    image_link: p.primaryImageId
      ? `${appBase}/api/img/${p.id}/${encodeURIComponent(p.primaryImageId)}`
      : '',
    brand: '', // Not modeled in v1; Meta accepts empty.
    gtin: p.barcode ?? '',
    mpn: p.sku,
    inventory: p.stockCount,
  }));
  const csv = Papa.unparse(data, { header: true, quotes: true });
  return {
    filename,
    contentType: 'text/csv; charset=utf-8',
    bytes: new TextEncoder().encode(csv),
  };
}

// ---------- Helpers ----------

function isValidProfile(s: string): s is ExportProfile {
  return s === 'xlsx_comprehensive' || s === 'csv_comprehensive' || s === 'meta_catalog_csv';
}

// ---------- Read helpers (used by the list endpoint) ----------

export type JobRow = {
  id: string;
  profile: ExportProfile;
  status: 'queued' | 'running' | 'done' | 'failed';
  filter: Record<string, unknown>;
  blobKey: string | null;
  error: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requesterId: string;
};

/**
 * Lists the most recent export jobs for a workspace, newest first. Used
 * by the Exports tab in the workspace dashboard.
 */
export async function listJobs(actor: ActorContext, limit = 20): Promise<JobRow[]> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const r = await c.query(
        `SELECT id, profile, status, filter, blob_key, error,
                queued_at, started_at, finished_at, requester_id
         FROM export_jobs
         WHERE workspace_id = $1
         ORDER BY queued_at DESC
         LIMIT $2`,
        [actor.workspaceId, limit],
      );
      return r.rows.map(
        (row): JobRow => ({
          id: row.id,
          profile: row.profile,
          status: row.status,
          filter: row.filter ?? {},
          blobKey: row.blob_key ?? null,
          error: row.error ?? null,
          queuedAt: row.queued_at instanceof Date ? row.queued_at.toISOString() : row.queued_at,
          startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
          finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : row.finished_at,
          requesterId: row.requester_id,
        }),
      );
    },
  );
}

/**
 * Fetches a single job row (for the download endpoint to look up the
 * blob key before streaming). Returns null if the job doesn't exist or
 * belongs to a different workspace (RLS hides it).
 */
export async function getJob(actor: ActorContext, jobId: string): Promise<JobRow | null> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const r = await c.query(
        `SELECT id, profile, status, filter, blob_key, error,
                queued_at, started_at, finished_at, requester_id
         FROM export_jobs WHERE id = $1`,
        [jobId],
      );
      if ((r.rowCount ?? 0) === 0) return null;
      const row = r.rows[0];
      return {
        id: row.id,
        profile: row.profile,
        status: row.status,
        filter: row.filter ?? {},
        blobKey: row.blob_key ?? null,
        error: row.error ?? null,
        queuedAt: row.queued_at instanceof Date ? row.queued_at.toISOString() : row.queued_at,
        startedAt: row.started_at instanceof Date ? row.started_at.toISOString() : row.started_at,
        finishedAt: row.finished_at instanceof Date ? row.finished_at.toISOString() : row.finished_at,
        requesterId: row.requester_id,
      };
    },
  );
}
