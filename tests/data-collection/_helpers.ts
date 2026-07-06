// Data Collection + Catalog test helpers. Build on the POS helpers (fresh client
// + L1 Owner + bucket-user session, products+pos enabled). No teardown (shared
// dev DB); each seed uses a fresh client so rows never collide.
import { neon } from '@neondatabase/serverless';
import { randomUUID } from 'node:crypto';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export async function enableDataCollection(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'data-collection', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

export async function enableCatalog(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'catalog', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

export async function seedDataCollectionClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableDataCollection(ctx);
  return ctx;
}

export async function slugOf(ctx: PosTestCtx): Promise<string> {
  const rows = (await sql`SELECT slug FROM public.clients WHERE id = ${ctx.clientId} LIMIT 1`) as Array<{ slug: string }>;
  return rows[0]!.slug;
}

export async function insertToken(
  ctx: PosTestCtx,
  opts: { expired?: boolean; used?: boolean } = {},
): Promise<string> {
  const token = randomUUID();
  const now = Date.now();
  const expiresIso = new Date(now + (opts.expired ? -86_400_000 : 7 * 86_400_000)).toISOString();
  const usedIso = opts.used ? new Date(now).toISOString() : null;
  await sql`
    INSERT INTO public.onboard_tokens (client_id, token, expires_at, used_at)
    VALUES (${ctx.clientId}, ${token}, ${expiresIso}::timestamptz, ${usedIso}::timestamptz)
  `;
  return token;
}

// Rotate the client IP per request so the shared Blob rate-limiter never trips.
let ipCounter = 40_000;
export function nextIp(): string {
  ipCounter += 1;
  return `10.40.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

export function publicGet(path: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: { 'x-nf-client-connection-ip': nextIp() },
  });
}

export function importReq(
  token: string,
  csv: string,
  opts: { dryRun?: boolean; hp?: string } = {},
): Request {
  const fd = new FormData();
  fd.append('file', new Blob([csv], { type: 'text/csv' }), 'products.csv');
  if (opts.hp !== undefined) fd.append('hp', opts.hp);
  const url = `http://localhost/api/onboard-import/${token}${opts.dryRun ? '?dry_run=1' : ''}`;
  return new Request(url, { method: 'POST', body: fd, headers: { 'x-nf-client-connection-ip': nextIp() } });
}

// A valid 2-row product CSV (one physical, one service) and a broken one.
export const VALID_CSV = [
  'name,type,price,status',
  'Demo Widget,physical,9.99,active',
  'Demo Service,service,25,active',
].join('\n');

export const INVALID_CSV = [
  'name,type,price,status',
  ',physical,9.99,active', // missing name → row error
].join('\n');
