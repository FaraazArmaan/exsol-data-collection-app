import { db } from './_shared/db';
import { computePayableSnapshotLineItems, type PayableSnapshotLineItem } from './_workforce-payable-time';

export interface PayrollSnapshotLine {
  id: string;
  user_node_id: string;
  hours: number;
  hourly_rate: number;
  amount: number;
  gross_amount: number;
  net_amount: number;
  currency: string;
  source_evidence: unknown[];
}

export interface PayrollSnapshot {
  id: string;
  status: 'building' | 'frozen';
  total_amount: number;
  frozen_at: string | null;
  lines: PayrollSnapshotLine[];
}

function asNumber(value: string | number): number {
  return Math.round(Number(value) * 100) / 100;
}

function asEvidence(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getSnapshotLines(snapshotId: string, clientId: string): Promise<PayrollSnapshotLine[]> {
  const rows = await db()`
    SELECT id, user_node_id, hours, hourly_rate, gross_amount, net_amount, currency, source_evidence
    FROM public.workforce_payroll_snapshot_lines
    WHERE snapshot_id = ${snapshotId}::uuid AND client_id = ${clientId}::uuid
    ORDER BY created_at, id
  ` as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id as string,
    user_node_id: row.user_node_id as string,
    hours: asNumber(row.hours as string | number),
    hourly_rate: asNumber(row.hourly_rate as string | number),
    amount: asNumber(row.gross_amount as string | number),
    gross_amount: asNumber(row.gross_amount as string | number),
    net_amount: asNumber(row.net_amount as string | number),
    currency: row.currency as string,
    source_evidence: asEvidence(row.source_evidence),
  }));
}

export async function getPayrollSnapshot(snapshotId: string, clientId: string): Promise<PayrollSnapshot | null> {
  const rows = await db()`
    SELECT id, status, total_amount, frozen_at
    FROM public.workforce_payroll_snapshots
    WHERE id = ${snapshotId}::uuid AND client_id = ${clientId}::uuid
    LIMIT 1
  ` as Array<{ id: string; status: 'building' | 'frozen'; total_amount: string | number; frozen_at: string | null }>;
  if (rows.length === 0) return null;
  const snapshot = rows[0]!;
  return {
    id: snapshot.id,
    status: snapshot.status,
    total_amount: asNumber(snapshot.total_amount),
    frozen_at: snapshot.frozen_at,
    lines: await getSnapshotLines(snapshot.id, clientId),
  };
}

async function persistLines(snapshotId: string, clientId: string, items: PayableSnapshotLineItem[]): Promise<void> {
  const sql = db();
  for (const item of items) {
    await sql`
      INSERT INTO public.workforce_payroll_snapshot_lines (
        snapshot_id, client_id, user_node_id, hours, hourly_rate, gross_amount, net_amount, source_evidence
      )
      VALUES (
        ${snapshotId}::uuid, ${clientId}::uuid, ${item.user_node_id}::uuid, ${item.hours}::numeric,
        ${item.hourly_rate}::numeric, ${item.amount}::numeric, ${item.amount}::numeric, ${JSON.stringify(item.source_evidence)}::jsonb
      )
      ON CONFLICT (snapshot_id, user_node_id) DO NOTHING
    `;
  }
}

export async function freezePayrollSnapshot(input: {
  clientId: string;
  periodId: string;
  periodStart: string;
  periodEnd: string;
  createdBy: string;
}): Promise<PayrollSnapshot> {
  const items = await computePayableSnapshotLineItems(input.clientId, input.periodStart, input.periodEnd);
  const computedTotal = Math.round(items.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  const sql = db();
  const inserted = await sql`
    INSERT INTO public.workforce_payroll_snapshots (client_id, period_id, total_amount, created_by)
    VALUES (${input.clientId}::uuid, ${input.periodId}::uuid, ${computedTotal}::numeric, ${input.createdBy}::uuid)
    ON CONFLICT (client_id, period_id) DO NOTHING
    RETURNING id
  ` as Array<{ id: string }>;

  const snapshotId = inserted[0]?.id ?? (await sql`
    SELECT id
    FROM public.workforce_payroll_snapshots
    WHERE client_id = ${input.clientId}::uuid AND period_id = ${input.periodId}::uuid
    LIMIT 1
  ` as Array<{ id: string }>)[0]?.id;
  if (!snapshotId) throw new Error('payroll_snapshot_create_failed');

  const existing = await getPayrollSnapshot(snapshotId, input.clientId);
  if (existing?.status === 'frozen') return existing;

  await persistLines(snapshotId, input.clientId, items);
  const persistedLines = await getSnapshotLines(snapshotId, input.clientId);
  const total = Math.round(persistedLines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  await sql`
    UPDATE public.workforce_payroll_snapshots
    SET status = 'frozen', total_amount = ${total}::numeric, frozen_at = COALESCE(frozen_at, now())
    WHERE id = ${snapshotId}::uuid AND client_id = ${input.clientId}::uuid
  `;
  return (await getPayrollSnapshot(snapshotId, input.clientId))!;
}
