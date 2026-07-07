// /api/warehouse/asn
//   GET  → list ASNs with per-shipment expected/received totals (warehouse.products.view)
//   POST → create an ASN, optionally pre-filled from a linked PO (warehouse.products.create)
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireWarehouse } from './_warehouse-authz';

export const config = { path: '/api/warehouse/asn' };

const STATUSES = new Set(['pending', 'received', 'cancelled', 'all']);

interface Line { product_id?: unknown; expected_qty?: unknown }
interface CreateBody {
  purchase_order_id?: unknown;
  reference?: unknown;
  carrier?: unknown;
  eta?: unknown;
  notes?: unknown;
  lines?: unknown;
}

async function handleGet(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.products.view']);
  if (!a.ok) return a.res;
  const raw = new URL(req.url).searchParams.get('status') ?? 'all';
  const status = STATUSES.has(raw) ? raw : 'all';
  const sql = db();
  const rows = (await sql`
    SELECT a.id, a.reference, a.carrier, to_char(a.eta, 'YYYY-MM-DD') AS eta,
           a.status, a.purchase_order_id, a.created_at,
           count(l.id)::int AS line_count,
           coalesce(sum(l.expected_qty), 0)::int AS total_expected,
           coalesce(sum(l.received_qty), 0)::int AS total_received
    FROM public.inbound_asns a
    LEFT JOIN public.asn_lines l ON l.asn_id = a.id
    WHERE a.client_id = ${a.ctx.clientId}::uuid
      AND (${status} = 'all' OR a.status = ${status})
    GROUP BY a.id
    ORDER BY a.created_at DESC
  `) as unknown[];
  return jsonOk({ asns: rows });
}

async function handlePost(req: Request): Promise<Response> {
  const a = await requireWarehouse(req, ['warehouse.products.create']);
  if (!a.ok) return a.res;

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return jsonError(400, 'invalid_json');
  }
  const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
  const carrier = typeof body.carrier === 'string' && body.carrier.trim() ? body.carrier.trim() : null;
  const eta = typeof body.eta === 'string' && body.eta.trim() ? body.eta.trim() : null;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  const poId = typeof body.purchase_order_id === 'string' && body.purchase_order_id.trim()
    ? body.purchase_order_id.trim() : null;
  if (!reference) return jsonError(400, 'reference_required');

  const sql = db();

  // Resolve lines: explicit body.lines win; otherwise derive from the PO items.
  let lines: Array<{ product_id: string; expected_qty: number }> = [];
  if (Array.isArray(body.lines) && body.lines.length > 0) {
    for (const raw of body.lines as Line[]) {
      const pid = typeof raw.product_id === 'string' ? raw.product_id.trim() : '';
      const qty = typeof raw.expected_qty === 'number' ? Math.trunc(raw.expected_qty) : NaN;
      if (!pid || !Number.isFinite(qty) || qty <= 0) return jsonError(400, 'invalid_line');
      lines.push({ product_id: pid, expected_qty: qty });
    }
  }

  if (poId) {
    const po = (await sql`
      SELECT id FROM public.purchase_orders WHERE id = ${poId}::uuid AND client_id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    if (po.length === 0) return jsonError(404, 'po_not_found');
    if (lines.length === 0) {
      const items = (await sql`
        SELECT product_id, qty AS expected_qty FROM public.purchase_order_items WHERE purchase_order_id = ${poId}::uuid
      `) as Array<{ product_id: string; expected_qty: number }>;
      lines = items.map((i) => ({ product_id: i.product_id, expected_qty: i.expected_qty }));
    }
  }

  if (lines.length === 0) return jsonError(400, 'lines_required');

  // Dedupe by product (last wins) and verify every product belongs to the client.
  const byProduct = new Map(lines.map((l) => [l.product_id, l.expected_qty]));
  const ids = [...byProduct.keys()];
  const owned = (await sql`
    SELECT id FROM public.products
    WHERE id = ANY(${ids}::uuid[]) AND client_id = ${a.ctx.clientId}::uuid AND deleted_at IS NULL
  `) as Array<{ id: string }>;
  if (owned.length !== ids.length) return jsonError(404, 'product_not_found');

  const asnRows = (await sql`
    INSERT INTO public.inbound_asns (client_id, purchase_order_id, reference, carrier, eta, notes, created_by)
    VALUES (${a.ctx.clientId}::uuid, ${poId}::uuid, ${reference}, ${carrier}, ${eta}::date, ${notes}, ${a.ctx.userNodeId}::uuid)
    RETURNING id, reference, carrier, to_char(eta, 'YYYY-MM-DD') AS eta, status, purchase_order_id, created_at
  `) as Array<Record<string, unknown>>;
  const asn = asnRows[0]!;

  for (const [pid, qty] of byProduct) {
    await sql`
      INSERT INTO public.asn_lines (asn_id, product_id, expected_qty)
      VALUES (${asn.id as string}::uuid, ${pid}::uuid, ${qty}::int)
    `;
  }

  return jsonOk({ asn }, { status: 201 });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'GET') return handleGet(req);
  if (req.method === 'POST') return handlePost(req);
  return jsonError(405, 'method_not_allowed');
}
