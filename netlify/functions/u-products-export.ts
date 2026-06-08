// GET /api/u-products-export?format=csv|xlsx&[filters]
//
// Streams a download of products that match the filters (same filter set as
// the list endpoint, minus paging). Locked-down to USD currency / Phase A.

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import * as XLSX from 'xlsx';

const HEADERS = [
  'sku','name','type','category','brand','price','currency',
  'stock_qty','unit','status','tags','description','created_at','hero_image_filename',
] as const;

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'GET') return jsonError(405, 'method_not_allowed');
  const auth = await authenticateForPermission(req, 'products.products.view');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const url = new URL(req.url);
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';
  const status = url.searchParams.get('status');
  const type   = url.searchParams.get('type');
  const category_id = url.searchParams.get('category_id');
  const brand  = url.searchParams.get('brand');
  const q      = url.searchParams.get('q');
  const qLike  = q ? `%${q.toLowerCase()}%` : null;
  const statusFilter = status === 'all' || !status ? null : status;

  const sql = db();
  const rows = (await sql`
    SELECT p.sku, p.name, p.type, c.name AS category, p.brand,
           (p.price_cents::numeric / 100) AS price, p.currency,
           p.stock_qty, p.unit, p.status, p.tags, p.description,
           p.created_at, p.hero_image_key AS hero_image_filename
    FROM public.products p
    LEFT JOIN public.product_categories c
      ON c.id = p.category_id AND c.deleted_at IS NULL
    WHERE p.client_id = ${clientId}::uuid
      AND p.deleted_at IS NULL
      AND (${type}::product_type IS NULL OR p.type = ${type}::product_type)
      AND (${category_id}::uuid IS NULL OR p.category_id = ${category_id}::uuid)
      AND (${brand}::text IS NULL OR p.brand = ${brand}::text)
      AND (${qLike}::text IS NULL OR (
        lower(p.name) LIKE ${qLike} OR
        lower(coalesce(p.sku, '')) LIKE ${qLike} OR
        lower(coalesce(p.brand, '')) LIKE ${qLike}
      ))
      AND (${statusFilter}::product_status IS NULL OR p.status = ${statusFilter}::product_status)
    ORDER BY p.created_at DESC
  `) as Array<Record<string, unknown>>;

  const today = new Date().toISOString().slice(0, 10);
  const slug  = clientId.slice(0, 8);
  const filename = `products_${slug}_${today}.${format}`;

  if (format === 'csv') {
    const lines: string[] = [HEADERS.join(',')];
    for (const r of rows) {
      lines.push(HEADERS.map((h) => {
        if (h === 'tags') return csvEscape((r['tags'] as string[] | null ?? []).join(';'));
        return csvEscape(r[h]);
      }).join(','));
    }
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // xlsx
  const sheetRows = rows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const h of HEADERS) {
      out[h] = h === 'tags' ? (r['tags'] as string[] | null ?? []).join(';') : r[h];
    }
    return out;
  });
  const sheet = XLSX.utils.json_to_sheet(sheetRows, { header: [...HEADERS] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Products');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Response(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
};
