// Finance per-client settings — currently the approval threshold (in base
// currency minor units). 0 = approvals disabled (nothing requires sign-off).
import type { NeonQueryFunction } from '@neondatabase/serverless';

type SQL = NeonQueryFunction<false, false>;

export async function fetchThreshold(sql: SQL, clientId: string): Promise<number> {
  const rows = (await sql`
    SELECT approval_threshold_cents FROM public.finance_settings
    WHERE client_id = ${clientId}::uuid LIMIT 1
  `) as Array<{ approval_threshold_cents: string }>;
  return rows[0] ? Number(rows[0].approval_threshold_cents) : 0;
}

// Whether a freshly-entered expense of `baseCents` needs approval, and thus its
// initial approval_status ('pending') vs NULL (auto-counted).
export function initialApprovalStatus(baseCents: number, threshold: number): 'pending' | null {
  return threshold > 0 && baseCents >= threshold ? 'pending' : null;
}
