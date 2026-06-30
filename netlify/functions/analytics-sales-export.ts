// GET /api/analytics-sales-export?from&to&format=xlsx|csv
//
// Exports the scoped Sales view: a Summary section (revenue + sales count) and
// a Rows section (the underlying paid/fulfilled sales). Honors the same scope +
// storefront-at-root rule as analytics-sales. Dates are rendered in the tenant
// timezone (clients.timezone). XLSX uses SheetJS (xlsx), matching the existing
// exporters (_shared/exporters/xlsx.ts).

import * as XLSX from 'xlsx';
import { jsonError } from './_shared/http';
import { db } from './_shared/db';
import { resolveAnalyticsAccess } from './_analytics-authz';
import { AnalyticsQuery } from './_analytics-validators';

export const config = { path: '/api/analytics-sales-export', method: 'GET' };

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405 });

  const auth = await resolveAnalyticsAccess(req, 'business');
  if (!auth.ok) return auth.res;
  const { clientId, isRootScope, scopeNodes } = auth.access;

  let q: AnalyticsQuery;
  try {
    q = AnalyticsQuery.parse(Object.fromEntries(new URL(req.url).searchParams));
  } catch (e: any) {
    return jsonError(400, 'invalid_query', { issues: e?.issues });
  }

  const sql = db();
  const nodes = scopeNodes ?? [];
  const noNodeFilter = scopeNodes === null;

  const tzRows = (await sql`
    SELECT timezone FROM public.clients WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ timezone: string }>;
  const tz = tzRows[0]?.timezone ?? 'UTC';

  const rows = (await sql`
    SELECT order_no,
           to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD HH24:MI') AS sold_at,
           status::text AS status, channel::text AS channel,
           customer_name, total_cents
    FROM public.sales
    WHERE bucket_id = ${clientId}::uuid
      AND status IN ('paid','fulfilled')
      AND created_at >= ${q.from}::date
      AND created_at <  (${q.to}::date + interval '1 day')
      AND (${noNodeFilter}::boolean OR created_by_user_node = ANY(${nodes}::uuid[]))
      AND (${isRootScope}::boolean OR source = 'pos')
    ORDER BY created_at ASC
  `) as Array<{
    order_no: number; sold_at: string; status: string; channel: string;
    customer_name: string; total_cents: string;
  }>;

  const revenueCents = rows.reduce((a, r) => a + Number(r.total_cents), 0);
  const salesCount = rows.length;

  const summaryAoa: Array<Array<string | number>> = [
    ['Analytics — Sales export'],
    ['Window', `${q.from} to ${q.to}`],
    ['Timezone', tz],
    ['Scope', isRootScope ? 'Whole tenant' : `Subtree (${nodes.length} nodes)`],
    [],
    ['Revenue (cents)', revenueCents],
    ['Sales', salesCount],
  ];
  const header = ['Order #', 'Sold at', 'Status', 'Channel', 'Customer', 'Total (cents)'];
  const rowsAoa: Array<Array<string | number>> = rows.map((r) => [
    r.order_no, r.sold_at, r.status, r.channel, r.customer_name, Number(r.total_cents),
  ]);

  const filenameBase = `sales-${q.from}_${q.to}`;

  if (q.format === 'csv') {
    const lines: string[] = [];
    for (const row of summaryAoa) lines.push(row.map(csvCell).join(','));
    lines.push('');
    lines.push(header.map(csvCell).join(','));
    for (const row of rowsAoa) lines.push(row.map(csvCell).join(','));
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // xlsx — two sheets: Summary + Rows.
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoa), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, ...rowsAoa]), 'Rows');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filenameBase}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
