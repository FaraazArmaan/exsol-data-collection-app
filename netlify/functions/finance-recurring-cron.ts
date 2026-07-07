// Scheduled function: materialize due recurring/milestone expense templates
// across ALL tenants, once daily. Registration is via `config.schedule` only
// (no netlify.toml entry) — mirrors booking-pending-cleanup. The real work lives
// in the shared, directly-testable materializeDueTemplates().
import { db } from './_shared/db';
import { materializeDueTemplates } from './_finance-recurring';

export const config = { schedule: '0 2 * * *' }; // daily at 02:00 UTC

export default async function handler(): Promise<Response> {
  const materialized = await materializeDueTemplates(db());
  return new Response(JSON.stringify({ materialized }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
