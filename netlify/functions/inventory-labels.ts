// GET /api/inventory/labels?kind=product|shelf&location_id=<uuid> — printable
// label sheet as a PDF via the shared pdf.ts seam.
//   product → every stock-tracked product with SKU / on-hand / reorder.
//   shelf   → one location's products + qty (needs location_id).
// The pdf seam is text-only, so the SKU is rendered as text; true barcode/QR
// IMAGE rendering awaits an image-capable PDF seam (logged for the handoff).
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireInventory } from './_inventory-authz';
import { renderPdf } from './_shared/pdf';

export const config = { path: '/api/inventory/labels', method: 'GET' };

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });
  const a = await requireInventory(req, ['inventory.products.view']);
  if (!a.ok) return a.res;

  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') === 'shelf' ? 'shelf' : 'product';
  const locationId = url.searchParams.get('location_id');
  const cid = a.ctx.clientId;
  const sql = db();
  const today = new Date().toISOString().slice(0, 10);

  let heading = 'Product Labels';
  let rows: { label: string; value: string }[] = [];

  if (kind === 'shelf') {
    if (!locationId) return jsonError(400, 'location_id_required');
    const locRows = (await sql`
      SELECT name FROM public.warehouse_locations
      WHERE id = ${locationId}::uuid AND client_id = ${cid}::uuid LIMIT 1
    `) as Array<{ name: string }>;
    if (locRows.length === 0) return jsonError(404, 'location_not_found');
    heading = `${locRows[0]!.name} - Shelf Labels`;
    const items = (await sql`
      SELECT p.name, p.sku, sbl.qty
      FROM public.stock_by_location sbl
      JOIN public.products p ON p.id = sbl.product_id
      WHERE sbl.location_id = ${locationId}::uuid AND p.deleted_at IS NULL
      ORDER BY p.name ASC
    `) as Array<{ name: string; sku: string | null; qty: number }>;
    rows = items.map((i) => ({ label: i.name, value: `SKU ${i.sku ?? 'n/a'}  -  Qty ${i.qty}` }));
  } else {
    const items = (await sql`
      SELECT p.name, p.sku, s.qty_on_hand, s.reorder_level
      FROM public.inventory_stock s
      JOIN public.products p ON p.id = s.product_id
      WHERE s.client_id = ${cid}::uuid AND p.deleted_at IS NULL
      ORDER BY p.name ASC
    `) as Array<{ name: string; sku: string | null; qty_on_hand: number; reorder_level: number }>;
    rows = items.map((i) => ({
      label: i.name,
      value: `SKU ${i.sku ?? 'n/a'}  -  ${i.qty_on_hand} on hand  -  reorder ${i.reorder_level}`,
    }));
  }

  const pdf = await renderPdf({
    title: 'Inventory Labels',
    heading,
    meta: [{ label: 'Generated', value: today }],
    bodyLines: rows.length === 0 ? ['No products to label yet.'] : undefined,
    rows: rows.length > 0 ? rows : undefined,
    footer: 'ExSol Inventory',
  });

  // pdf is a Uint8Array; cast to BodyInit (TS 5.7's typed-array generics don't
  // match BufferSource here, but the bytes are a valid Response body at runtime).
  return new Response(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="inventory-${kind}-labels.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
