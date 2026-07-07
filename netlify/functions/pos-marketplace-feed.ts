// GET /api/pos/marketplace-feed?platform=amazon|flipkart|meta
//
// Marketplace SYNC = file EXPORT (no live seller APIs). Generates a per-catalog
// product feed for one marketplace by reusing the existing platform formatters
// (_shared/exporters), scoped to storefront-visible active products. Returns the
// raw feed file as a download — the lightweight sibling of u-products-export
// (which bundles image bytes into a ZIP). Gated on pos.sale.refund with L1 bypass.

import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requirePos } from './_pos-authz';
import { exporters, type ExportPlatform } from './_shared/exporters';
import { buildStorefrontExportRows } from './_shared/exporters/build-rows';

export const config = { path: '/api/pos/marketplace-feed' };

// The marketplace subset (general csv/xlsx/whatsapp exports stay on u-products-export).
const MARKETPLACES: ReadonlySet<ExportPlatform> = new Set(['amazon', 'flipkart', 'meta']);

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requirePos(req, ['pos.sale.refund']);
  if (!a.ok) return a.res;

  const platform = new URL(req.url).searchParams.get('platform') as ExportPlatform | null;
  if (!platform || !MARKETPLACES.has(platform)) return jsonError(400, 'invalid_platform');

  const sql = db();
  const { rows, clientSlug } = await buildStorefrontExportRows(sql, a.ctx.clientId);
  if (rows.length === 0) return jsonError(404, 'no_products');

  const result = exporters[platform]({ rows, clientSlug, generatedAt: new Date() });
  const ext = result.filename.split('.').pop() ?? 'txt';
  const date = new Date().toISOString().slice(0, 10);
  const downloadName = `${clientSlug}-${platform}-${date}.${ext}`;

  // amazon/flipkart/meta return strings; coerce any Buffer to bytes for Response.
  const body = typeof result.body === 'string' ? result.body : new Uint8Array(result.body);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': result.contentType,
      'Content-Disposition': `attachment; filename="${downloadName}"`,
    },
  });
}
