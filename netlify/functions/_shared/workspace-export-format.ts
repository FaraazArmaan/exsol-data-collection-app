// Workspace data export — formatters.
//
// Two functions: toJsonResponse, toZipResponse.
// Both take a (snapshot, slug) and return a Response with the right headers
// already set. Caller streams them as-is.

import JSZip from 'jszip';
import type { WorkspaceSnapshot } from './workspace-export-types';
import { countTables } from './workspace-export-types';
import { csvEscape } from './exporters/format-helpers';
import { ExportTooLargeError } from './exporters/types';

// 4 MB cap applies to each response's WIRE bytes (post-serialization,
// post-compression for ZIP). This is the actual Netlify Functions
// response-size limit. ZIP can therefore carry more raw data than JSON
// for the same cap — that's an intentional consequence of compression,
// not an asymmetry to fix.
//
// Emergency override: set WORKSPACE_EXPORT_MAX_BYTES in the environment
// (e.g. for testing or to temporarily raise/lower the cap without a deploy).
// The default value is kept as a named export for tests that need to read it.
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;

/** Returns the effective byte cap, re-reading the env var each call so tests can override it. */
function getMaxBytes(): number {
  const override = Number(process.env.WORKSPACE_EXPORT_MAX_BYTES);
  return override > 0 ? override : DEFAULT_MAX_BYTES;
}

/** @deprecated Use DEFAULT_MAX_BYTES or getMaxBytes() instead. Kept for unit-test back-compat. */
export const MAX_BYTES = DEFAULT_MAX_BYTES;

export function isoFilenameStamp(d: Date): string {
  // YYYYMMDDTHHMMSSZ — filesystem-safe (no colons or hyphens in the time).
  const iso = d.toISOString();          // 2026-06-11T10:23:45.678Z
  const datePart = iso.slice(0, 10).replace(/-/g, '');    // 20260611
  const timePart = iso.slice(11, 19).replace(/:/g, '');   // 102345
  return `${datePart}T${timePart}Z`;
}

function buildFilename(slug: string, ext: 'json' | 'zip'): string {
  return `workspace-${slug}-${isoFilenameStamp(new Date())}.${ext}`;
}

export function toJsonResponse(snap: WorkspaceSnapshot, slug: string): Response {
  const body = JSON.stringify(snap, null, 2);
  const byteLength = Buffer.byteLength(body, 'utf8');
  const cap = getMaxBytes();
  if (byteLength > cap) {
    throw new ExportTooLargeError(byteLength, cap);
  }
  const filename = buildFilename(slug, 'json');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(byteLength),
      'Cache-Control': 'no-store',
    },
  });
}

// --- ZIP formatter ---
export async function toZipResponse(snap: WorkspaceSnapshot, slug: string): Promise<Response> {
  const z = new JSZip();

  const manifest = {
    schema_version: snap.schema_version,
    exported_at: snap.exported_at,
    exported_by: snap.exported_by,
    client_id: typeof snap.client.id === 'string' ? snap.client.id : null,
    slug,
    table_counts: countTables(snap),
  };
  z.file('_manifest.json', JSON.stringify(manifest, null, 2));

  z.file('README.txt', [
    `ExSol Workspace Data Export`,
    `Workspace slug: ${slug}`,
    `Exported at:    ${snap.exported_at}`,
    `Exported by:    ${snap.exported_by.email} (${snap.exported_by.kind})`,
    `Schema version: ${snap.schema_version}`,
    ``,
    `Files in this archive (CSV with RFC 4180-style quoting, LF line endings):`,
    `  client.csv                       — single row from public.clients`,
    `  enabled_products.csv             — one column: product_key`,
    `  client_levels.csv                — level definitions`,
    `  client_roles.csv                 — role definitions`,
    `  client_cardinality_rules.csv     — how many of each role at each level`,
    `  user_nodes.csv                   — the org tree (parent_id preserved)`,
    `  user_node_credentials.csv        — workspace logins`,
    `  files/files.csv                  — file metadata`,
    `  files/file_categories.csv        — file ↔ category links`,
    `  files/file_allowed_nodes.csv     — explicit per-user audience grants`,
    `  files/file_allowed_roles.csv     — per-role audience grants`,
    `  files/file_allowed_users.csv     — per-user audience grants`,
    `  products/products.csv            — product rows`,
    `  products/product_categories.csv  — category definitions`,
    `  products/product_images.csv      — metadata only; no binaries`,
    ``,
    `REDACTIONS (always absent from this export):`,
    `  - password_hash`,
    `  - temp_password_plain`,
    `  - password_reset_requested_at`,
    ``,
    `File and image binaries are NOT included; only their metadata + storage`,
    `keys. The audit log (public.audit_log) is NOT included.`,
  ].join('\n'));

  // Top-level CSVs
  z.file('client.csv', rowsToCsv([snap.client]));
  z.file('enabled_products.csv', rowsToCsv(snap.enabled_products.map((k) => ({ product_key: k }))));
  z.file('client_levels.csv', rowsToCsv(snap.levels));
  z.file('client_roles.csv', rowsToCsv(snap.roles));
  z.file('client_cardinality_rules.csv', rowsToCsv(snap.cardinality_rules));
  z.file('user_nodes.csv', rowsToCsv(snap.user_nodes));
  z.file('user_node_credentials.csv', rowsToCsv(snap.credentials));

  // files/ — createFolders:false suppresses implicit directory entries in the archive
  z.file('files/files.csv', rowsToCsv(snap.files.files), { createFolders: false });
  z.file('files/file_categories.csv', rowsToCsv(snap.files.categories), { createFolders: false });
  z.file('files/file_allowed_nodes.csv', rowsToCsv(snap.files.allowed_nodes), { createFolders: false });
  z.file('files/file_allowed_roles.csv', rowsToCsv(snap.files.allowed_roles), { createFolders: false });
  z.file('files/file_allowed_users.csv', rowsToCsv(snap.files.allowed_users), { createFolders: false });

  // products/ — same
  z.file('products/products.csv', rowsToCsv(snap.products.products), { createFolders: false });
  z.file('products/product_categories.csv', rowsToCsv(snap.products.categories), { createFolders: false });
  z.file('products/product_images.csv', rowsToCsv(snap.products.images), { createFolders: false });

  const buf = await z.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  const cap = getMaxBytes();
  if (buf.byteLength > cap) {
    throw new ExportTooLargeError(buf.byteLength, cap);
  }

  const filename = buildFilename(slug, 'zip');
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buf.byteLength),
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * CSV-stringify an array of plain objects (RFC 4180-ish).
 *
 * - Header row is the union of all keys across all rows (sparse rows get
 *   empty cells for missing keys). This is intentional — DB result rows
 *   always share a schema in practice, but tests may pass mixed-shape
 *   fixtures.
 * - Object/array values are JSON-encoded then csv-escaped (used for jsonb
 *   columns like user_nodes.fields).
 * - null / undefined → empty cell.
 *
 * Returns '' for an empty input array.
 */
export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const lines: string[] = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      const v = r[h];
      if (v == null) return '';
      if (typeof v === 'object') return csvEscape(JSON.stringify(v));
      return csvEscape(v as string | number);
    }).join(','));
  }
  return lines.join('\n');
}


