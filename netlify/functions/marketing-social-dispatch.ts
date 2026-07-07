// Scheduled function: posts every due social post (scheduled_for <= now) across
// all tenants via the provider seam. Runs every 5 minutes. Mirrors the cron shape
// of booking-pending-cleanup.ts.
// NOTE: Netlify scheduled functions are greenfield here — verify the cron
// registers on first deploy (probe the endpoint / check the Functions log).
import { db } from './_shared/db';
import { dispatchDue } from './_marketing-social';

export const config = { schedule: '*/5 * * * *' };

export default async function handler(): Promise<Response> {
  const result = await dispatchDue(db());
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
