// POST /api/onboard-import/:token — guest product import for an onboarding link.
// Reuses the shared server parser (parseCsvBytes, CSV+XLSX). Anti-abuse order:
// rate-limit → honeypot → token validate. ?dry_run=1 previews without consuming
// the token; a clean commit consumes the token atomically (single-use) then
// inserts the valid rows as new products for the token's client.
import { jsonOk, jsonError } from './_shared/http';
import { db } from './_shared/db';
import { checkLimit, clientIp } from './_pub-ratelimit';
import { parseCsvBytes } from './_shared/products-import-parse';

export const config = { path: '/api/onboard-import/:token', method: 'POST' };

function tokenFromUrl(req: Request): string {
  const segs = new URL(req.url).pathname.split('/').filter(Boolean);
  return decodeURIComponent(segs[segs.length - 1] ?? '');
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const rl = await checkLimit(clientIp(req), 'onboard-import', { perMinute: 10 });
  if (!rl.ok) return jsonError(429, rl.code);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, 'invalid_multipart');
  }

  // Honeypot: a real user never fills the hidden `hp` field.
  const hp = form.get('hp');
  if (typeof hp === 'string' && hp.trim() !== '') return jsonError(400, 'invalid_request');

  const token = tokenFromUrl(req);
  if (!token) return jsonError(404, 'not_found');

  const file = form.get('file');
  if (!(file instanceof Blob)) return jsonError(400, 'file_required');

  const sql = db();
  const tokRows = (await sql`
    SELECT client_id, used_at, (expires_at <= now()) AS expired
    FROM public.onboard_tokens WHERE token = ${token} LIMIT 1
  `) as Array<{ client_id: string; used_at: string | null; expired: boolean }>;
  const tok = tokRows[0];
  if (!tok) return jsonError(404, 'not_found');
  if (tok.used_at !== null) return jsonError(410, 'token_used');
  if (tok.expired) return jsonError(410, 'token_expired');
  const clientId = tok.client_id;

  const buf = Buffer.from(await file.arrayBuffer());
  const parsed = parseCsvBytes(buf);
  const validRows = parsed.rows.filter((r) => r.errors.length === 0);
  const errors = parsed.rows.flatMap((r) =>
    r.errors.map((e) => ({ row: r.row_index, field: e.field, message: e.message })),
  );
  const summary = { total: parsed.rows.length, to_create: validRows.length, errors: errors.length };

  const dryRun = new URL(req.url).searchParams.get('dry_run') === '1'
    || new URL(req.url).searchParams.get('dry_run') === 'true';
  if (dryRun) return jsonOk({ valid: validRows.length, errors, summary });
  if (errors.length > 0) return jsonOk({ committed: false, errors, summary });

  // Consume the token atomically — the `used_at IS NULL` guard makes it single-use
  // against a double-submit race. If it's already gone, don't import twice.
  const consumed = (await sql`
    UPDATE public.onboard_tokens SET used_at = now()
    WHERE token = ${token} AND used_at IS NULL
    RETURNING id
  `) as Array<{ id: string }>;
  if (consumed.length === 0) return jsonError(410, 'token_used');

  let created = 0;
  for (const r of validRows) {
    const isService = r.type === 'service';
    await sql`
      INSERT INTO public.products
        (client_id, type, name, description, brand, tags, price_cents, sku, stock_qty, unit, status)
      VALUES (
        ${clientId}::uuid, ${r.type}::product_type, ${r.name}, ${r.description}, ${r.brand},
        ${r.tags}::text[], ${r.price_cents},
        ${isService ? null : r.sku}, ${isService ? null : r.stock_qty}, ${isService ? null : r.unit},
        ${r.status}::product_status
      )
    `;
    created++;
  }

  return jsonOk({ committed: true, created, summary });
}
