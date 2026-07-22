import { db } from './_shared/db';

export interface PayableLineItem {
  user_node_id: string;
  hours: number;
  hourly_rate: number;
  amount: number;
}

export interface PayableSnapshotLineItem extends PayableLineItem {
  source_evidence: unknown[];
}

async function reconcileApprovedTimesheets(clientId: string): Promise<void> {
  await db()`
    INSERT INTO public.workforce_payable_time_entries (
      client_id,
      resource_id,
      user_node_id,
      work_date,
      minutes,
      source_type,
      source_id,
      approved_by,
      approved_at,
      notes,
      source_snapshot
    )
    SELECT
      te.client_id,
      te.resource_id,
      te.user_node_id,
      te.entry_date,
      ROUND(EXTRACT(EPOCH FROM (te.end_time - te.start_time)) / 60)::integer,
      'approved_timesheet',
      te.id,
      te.approved_by,
      te.approved_at,
      te.notes,
      jsonb_build_object(
        'entry_date', to_char(te.entry_date, 'YYYY-MM-DD'),
        'start_time', left(te.start_time::text, 5),
        'end_time', left(te.end_time::text, 5),
        'timesheet_id', te.id
      )
    FROM public.timesheet_entries te
    WHERE te.client_id = ${clientId}::uuid
      AND te.approved_at IS NOT NULL
      AND te.user_node_id IS NOT NULL
    ON CONFLICT (client_id, source_type, source_id) DO NOTHING
  `;
}

export async function computePayableSnapshotLineItems(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PayableSnapshotLineItem[]> {
  // Repair imported or legacy approved entries before payroll reads the immutable ledger.
  await reconcileApprovedTimesheets(clientId);
  const rows = await db()`
    SELECT
      pt.user_node_id,
      SUM(pt.minutes)::numeric / 60 AS hours,
      SUM(
        (pt.minutes::numeric / 60) * COALESCE((
          SELECT pr.hourly_rate
          FROM public.payroll_rates pr
          WHERE pr.client_id = ${clientId}::uuid
            AND pr.user_node_id = pt.user_node_id
            AND pr.effective_from <= pt.work_date
          ORDER BY pr.effective_from DESC
          LIMIT 1
        ), 0)
      ) AS amount,
      jsonb_agg(
        jsonb_build_object(
          'payable_time_entry_id', pt.id,
          'work_date', to_char(pt.work_date, 'YYYY-MM-DD'),
          'minutes', pt.minutes,
          'source_type', pt.source_type,
          'source_id', pt.source_id,
          'source_snapshot', pt.source_snapshot,
          'hourly_rate', COALESCE((
            SELECT pr.hourly_rate
            FROM public.payroll_rates pr
            WHERE pr.client_id = ${clientId}::uuid
              AND pr.user_node_id = pt.user_node_id
              AND pr.effective_from <= pt.work_date
            ORDER BY pr.effective_from DESC
            LIMIT 1
          ), 0)
        )
        ORDER BY pt.work_date, pt.id
      ) AS source_evidence
    FROM public.workforce_payable_time_entries pt
    WHERE pt.client_id = ${clientId}::uuid
      AND pt.work_date BETWEEN ${periodStart}::date AND ${periodEnd}::date
    GROUP BY pt.user_node_id
  ` as Array<{ user_node_id: string; hours: string | number; amount: string | number; source_evidence: unknown[] }>;

  return rows.map((row) => {
    const hours = Number(row.hours);
    const amount = Math.round(Number(row.amount) * 100) / 100;
    return {
      user_node_id: row.user_node_id,
      hours,
      hourly_rate: hours === 0 ? 0 : Math.round((amount / hours) * 100) / 100,
      amount,
      source_evidence: Array.isArray(row.source_evidence) ? row.source_evidence : [],
    };
  });
}

export async function computePayableLineItems(
  clientId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PayableLineItem[]> {
  const items = await computePayableSnapshotLineItems(clientId, periodStart, periodEnd);
  return items.map(({ source_evidence: _sourceEvidence, ...item }) => item);
}
