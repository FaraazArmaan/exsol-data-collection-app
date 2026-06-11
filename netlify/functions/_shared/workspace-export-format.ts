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

export const MAX_BYTES = 4 * 1024 * 1024;

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
  if (body.length > MAX_BYTES) {
    throw new ExportTooLargeError(body.length, MAX_BYTES);
  }
  const filename = buildFilename(slug, 'json');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// --- ZIP formatter (implemented in Task 4) ---
export async function toZipResponse(_snap: WorkspaceSnapshot, _slug: string): Promise<Response> {
  throw new Error('toZipResponse: not implemented yet');
}

// Re-export for callers
export { csvEscape };

// Internal helper exported only for testing the per-table CSV builder in Task 4.
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

// re-export for the endpoint
export { countTables, JSZip };
