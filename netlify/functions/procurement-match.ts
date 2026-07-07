// /api/procurement/match — 3-way match (PO × goods-received × invoice).
//   GET  ?purchase_order_id= → the comparison (per-line ordered vs received,
//        PO total vs invoiced total, mismatch flags, expensed status).
//   POST { purchase_order_id } → confirm a clean match: creates a Finance expense
//        (category 'supplies') and links it on the PO. 409 on mismatch / double.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { requireProcurement } from './_procurement-authz';

export const config = { path: '/api/procurement/match', method: ['GET', 'POST'] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MatchLine {
  product_id: string;
  product_name: string;
  ordered_qty: number;
  received_qty: number;
  unit_cost_cents: number;
  line_total_cents: number;
  qty_ok: boolean;
}
interface Match {
  po_total_cents: number;
  invoiced_total_cents: number;
  received_recorded: boolean;
  invoice_recorded: boolean;
  qty_ok: boolean;
  amount_ok: boolean;
  matched: boolean;
  expensed: boolean;
  expense_id: string | null;
  lines: MatchLine[];
  mismatches: Array<{ type: string; detail?: string }>;
}

async function computeMatch(
  sql: ReturnType<typeof db>,
  poId: string,
  clientId: string,
): Promise<Match | null> {
  const poRows = (await sql`
    SELECT id, finance_expense_id FROM public.purchase_orders
    WHERE id = ${poId}::uuid AND client_id = ${clientId}::uuid LIMIT 1
  `) as Array<{ id: string; finance_expense_id: string | null }>;
  if (poRows.length === 0) return null;

  const poItems = (await sql`
    SELECT poi.product_id, p.name AS product_name, poi.qty AS ordered_qty, poi.unit_cost_cents
    FROM public.purchase_order_items poi
    JOIN public.products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = ${poId}::uuid
    ORDER BY p.name ASC
  `) as Array<{ product_id: string; product_name: string; ordered_qty: number; unit_cost_cents: string }>;

  const received = (await sql`
    SELECT gri.product_id, sum(gri.qty_received)::int AS received_qty
    FROM public.goods_receipt_items gri
    JOIN public.goods_receipts gr ON gr.id = gri.goods_receipt_id
    WHERE gr.purchase_order_id = ${poId}::uuid
    GROUP BY gri.product_id
  `) as Array<{ product_id: string; received_qty: number }>;
  const receivedMap = new Map(received.map((r) => [r.product_id, r.received_qty]));

  const inv = (await sql`
    SELECT coalesce(sum(amount_cents), 0)::bigint AS total, count(*)::int AS n
    FROM public.supplier_invoices WHERE purchase_order_id = ${poId}::uuid
  `) as Array<{ total: string; n: number }>;
  const grn = (await sql`
    SELECT count(*)::int AS n FROM public.goods_receipts WHERE purchase_order_id = ${poId}::uuid
  `) as Array<{ n: number }>;

  const lines: MatchLine[] = poItems.map((li) => {
    const receivedQty = receivedMap.get(li.product_id) ?? 0;
    const unit = Number(li.unit_cost_cents);
    return {
      product_id: li.product_id,
      product_name: li.product_name,
      ordered_qty: li.ordered_qty,
      received_qty: receivedQty,
      unit_cost_cents: unit,
      line_total_cents: li.ordered_qty * unit,
      qty_ok: receivedQty === li.ordered_qty,
    };
  });

  const poTotal = lines.reduce((s, l) => s + l.line_total_cents, 0);
  const invoicedTotal = Number(inv[0]?.total ?? 0);
  const receivedRecorded = (grn[0]?.n ?? 0) > 0;
  const invoiceRecorded = (inv[0]?.n ?? 0) > 0;
  const qtyOk = receivedRecorded && lines.every((l) => l.qty_ok);
  const amountOk = invoiceRecorded && poTotal === invoicedTotal;
  const matched = qtyOk && amountOk;

  const mismatches: Array<{ type: string; detail?: string }> = [];
  if (!receivedRecorded) mismatches.push({ type: 'no_grn', detail: 'No goods receipt recorded yet.' });
  for (const l of lines) {
    if (l.received_qty !== l.ordered_qty) {
      mismatches.push({ type: 'qty', detail: `${l.product_name}: ordered ${l.ordered_qty}, received ${l.received_qty}` });
    }
  }
  if (!invoiceRecorded) mismatches.push({ type: 'no_invoice', detail: 'No supplier invoice recorded yet.' });
  else if (poTotal !== invoicedTotal) mismatches.push({ type: 'amount', detail: `PO total ${poTotal} vs invoiced ${invoicedTotal}` });

  return {
    po_total_cents: poTotal,
    invoiced_total_cents: invoicedTotal,
    received_recorded: receivedRecorded,
    invoice_recorded: invoiceRecorded,
    qty_ok: qtyOk,
    amount_ok: amountOk,
    matched,
    expensed: poRows[0]!.finance_expense_id != null,
    expense_id: poRows[0]!.finance_expense_id,
    lines,
    mismatches,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const poId = (new URL(req.url).searchParams.get('purchase_order_id')
    ?? (req.method === 'POST' ? undefined : '') ?? '').trim();

  if (req.method === 'GET') {
    const a = await requireProcurement(req, ['procurement.products.view']);
    if (!a.ok) return a.res;
    if (!UUID_RE.test(poId)) return jsonError(400, 'purchase_order_id_required');
    const sql = db();
    const match = await computeMatch(sql, poId, a.ctx.clientId);
    if (!match) return jsonError(404, 'not_found');
    return jsonOk(match as unknown as Record<string, unknown>);
  }

  if (req.method === 'POST') {
    const a = await requireProcurement(req, ['procurement.products.edit']);
    if (!a.ok) return a.res;
    let body: { purchase_order_id?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonError(400, 'invalid_json');
    }
    const id = typeof body.purchase_order_id === 'string' ? body.purchase_order_id.trim() : '';
    if (!UUID_RE.test(id)) return jsonError(400, 'purchase_order_id_required');

    const sql = db();
    const match = await computeMatch(sql, id, a.ctx.clientId);
    if (!match) return jsonError(404, 'not_found');
    if (match.expensed) return jsonError(409, 'already_expensed');
    if (!match.matched) return jsonError(409, 'not_matched', { mismatches: match.mismatches });

    const cur = (await sql`
      SELECT base_currency FROM public.clients WHERE id = ${a.ctx.clientId}::uuid LIMIT 1
    `) as Array<{ base_currency: string | null }>;
    const currency = cur[0]?.base_currency ?? 'INR';
    const total = match.po_total_cents;

    // Create the Finance expense, then link it — the WHERE finance_expense_id IS
    // NULL guard makes the link single-shot against a double-confirm race.
    const exp = (await sql`
      INSERT INTO public.finance_expenses
        (client_id, category, amount_cents, currency, amount_base_cents, fx_rate, note, incurred_on, created_by, approval_status)
      VALUES (${a.ctx.clientId}::uuid, 'supplies', ${total}::bigint, ${currency}, ${total}::bigint, 1,
              ${`3-way match: PO ${id}`}, current_date, ${a.ctx.userNodeId}::uuid, NULL)
      RETURNING id
    `) as Array<{ id: string }>;
    const expenseId = exp[0]!.id;

    const linked = (await sql`
      UPDATE public.purchase_orders SET finance_expense_id = ${expenseId}::uuid
      WHERE id = ${id}::uuid AND finance_expense_id IS NULL
      RETURNING id
    `) as unknown[];
    if (linked.length === 0) {
      await sql`DELETE FROM public.finance_expenses WHERE id = ${expenseId}::uuid`;
      return jsonError(409, 'already_expensed');
    }

    return jsonOk({ ok: true, expense_id: expenseId, amount_cents: total }, { status: 201 });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
