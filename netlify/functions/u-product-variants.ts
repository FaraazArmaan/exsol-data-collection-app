// /api/u-product-variants and /api/u-product-variants/:id — Product Manager variants.
// Variants are catalog-owned facts. Inventory owns their quantities; POS and
// storefront consume them only through the explicit variant line contract.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { logAudit } from './_shared/audit';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';

const UUID = z.string().uuid();
const Fields = {
  title: z.string().trim().min(1).max(120),
  option_values: z.record(z.unknown()),
  sku: z.string().trim().min(1).max(80).nullable(),
  barcode: z.string().trim().min(1).max(80).nullable(),
  price_cents: z.number().int().min(0).nullable(),
  sale_price_cents: z.number().int().min(0).nullable(),
  sale_starts_at: z.string().datetime().nullable(),
  sale_ends_at: z.string().datetime().nullable(),
  status: z.enum(['active', 'draft', 'archived']),
  availability: z.enum(['in_stock', 'out_of_stock', 'preorder', 'discontinued']),
  pos_visible: z.boolean(),
  storefront_visible: z.boolean(),
} as const;

const CreateBody = z.object({ product_id: UUID, ...Fields }).partial().required({ product_id: true, title: true });
const PatchBody = z.object({ expected_updated_at: z.string().datetime().optional(), ...Fields })
  .partial()
  .refine((v) => Object.keys(v).some((key) => key !== 'expected_updated_at'), { message: 'empty patch' });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const id = new URL(req.url).pathname.match(/u-product-variants\/([^/?]+)/)?.[1];
  return id && UUID_RE.test(id) ? id : null;
}

function rowFields() {
  return `id, client_id, product_id, title, option_values, sku, barcode, price_cents, sale_price_cents,
          sale_starts_at, sale_ends_at, status, availability, pos_visible, storefront_visible, created_at,
          to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`;
}

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  const id = idFromUrl(req);
  if (req.method === 'GET' && !id) return list(req);
  if (req.method === 'POST' && !id) return create(req);
  if (req.method === 'PATCH' && id) return patch(req, id);
  return jsonError(req.method === 'GET' || req.method === 'POST' || req.method === 'PATCH' ? 400 : 405, id ? 'invalid_id' : 'method_not_allowed');
}

async function auth(req: Request, permission: 'products.products.view' | 'products.products.create' | 'products.products.edit') {
  const session = await authenticateForPermission(req, permission);
  if (session instanceof Response) return session;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  return { session, clientId: scope.clientId };
}

async function list(req: Request): Promise<Response> {
  const a = await auth(req, 'products.products.view');
  if (a instanceof Response) return a;
  const productId = new URL(req.url).searchParams.get('product_id');
  if (!productId || !UUID_RE.test(productId)) return jsonError(400, 'product_id_required');
  const sql = db();
  const rows = (await sql(`
    SELECT ${rowFields()} FROM public.product_variants
    WHERE client_id = $1::uuid AND product_id = $2::uuid
    ORDER BY title
  `, [a.clientId, productId])) as Array<Record<string, unknown>>;
  return jsonOk({ items: rows });
}

async function create(req: Request): Promise<Response> {
  const a = await auth(req, 'products.products.create');
  if (a instanceof Response) return a;
  const parsed = CreateBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const v = parsed.data;
  const sql = db();
  const product = (await sql`
    SELECT id, type FROM public.products
    WHERE id = ${v.product_id}::uuid AND client_id = ${a.clientId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `) as Array<{ id: string; type: 'physical' | 'service' }>;
  if (!product[0]) return jsonError(404, 'product_not_found');
  if (product[0].type !== 'physical') return jsonError(422, 'product_not_variant_eligible');
  if (v.sku) {
    const clashes = (await sql`
      SELECT id FROM public.products WHERE client_id = ${a.clientId}::uuid AND sku = ${v.sku} AND deleted_at IS NULL
      UNION ALL
      SELECT id FROM public.product_variants WHERE client_id = ${a.clientId}::uuid AND sku = ${v.sku}
      LIMIT 1
    `) as Array<{ id: string }>;
    if (clashes[0]) return jsonError(409, 'sku_in_use');
  }
  try {
    const rows = (await sql`
      INSERT INTO public.product_variants (
        client_id, product_id, title, option_values, sku, barcode, price_cents,
        sale_price_cents, sale_starts_at, sale_ends_at, status, availability, pos_visible, storefront_visible
      ) VALUES (
        ${a.clientId}::uuid, ${v.product_id}::uuid, ${v.title}, ${JSON.stringify(v.option_values ?? {})}::jsonb,
        ${v.sku ?? null}, ${v.barcode ?? null}, ${v.price_cents ?? null}, ${v.sale_price_cents ?? null},
        ${v.sale_starts_at ?? null}::timestamptz, ${v.sale_ends_at ?? null}::timestamptz,
        ${v.status ?? 'draft'}::product_status, ${v.availability ?? 'in_stock'},
        ${v.pos_visible ?? true}, ${v.storefront_visible ?? true}
      ) RETURNING id, client_id, product_id, title, option_values, sku, barcode, price_cents, sale_price_cents,
                  sale_starts_at, sale_ends_at, status, availability, pos_visible, storefront_visible, created_at, updated_at
    `) as Array<Record<string, unknown>>;
    await logAudit(sql, {
      session: a.session, op: 'products.variant_created', clientId: a.clientId,
      targetType: 'product_variant', targetId: String(rows[0]!.id), detail: { product_id: v.product_id, title: v.title },
    });
    return jsonOk(rows[0]!, { status: 201 });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') return jsonError(409, 'variant_conflict');
    throw error;
  }
}

async function patch(req: Request, id: string): Promise<Response> {
  const a = await auth(req, 'products.products.edit');
  if (a instanceof Response) return a;
  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const { expected_updated_at, ...v } = parsed.data;
  const sql = db();
  const current = (await sql`
    SELECT id, product_id, updated_at FROM public.product_variants
    WHERE id = ${id}::uuid AND client_id = ${a.clientId}::uuid
    LIMIT 1
  `) as Array<{ id: string; product_id: string; updated_at: string }>;
  if (!current[0]) return jsonError(404, 'not_found');
  if (v.sku) {
    const clashes = (await sql`
      SELECT id FROM public.products WHERE client_id = ${a.clientId}::uuid AND sku = ${v.sku} AND deleted_at IS NULL
      UNION ALL
      SELECT id FROM public.product_variants WHERE client_id = ${a.clientId}::uuid AND sku = ${v.sku} AND id <> ${id}::uuid
      LIMIT 1
    `) as Array<{ id: string }>;
    if (clashes[0]) return jsonError(409, 'sku_in_use');
  }
  const columns: Array<[keyof typeof v, string, string?]> = [
    ['title', 'title'], ['option_values', 'option_values', 'jsonb'], ['sku', 'sku'], ['barcode', 'barcode'],
    ['price_cents', 'price_cents'], ['sale_price_cents', 'sale_price_cents'], ['sale_starts_at', 'sale_starts_at', 'timestamptz'],
    ['sale_ends_at', 'sale_ends_at', 'timestamptz'], ['status', 'status', 'product_status'], ['availability', 'availability'],
    ['pos_visible', 'pos_visible'], ['storefront_visible', 'storefront_visible'],
  ];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column, cast] of columns) {
    if (v[key] === undefined) continue;
    params.push(key === 'option_values' ? JSON.stringify(v[key]) : v[key]);
    sets.push(`${column} = $${params.length}${cast ? `::${cast}` : ''}`);
  }
  params.push(id, a.clientId);
  const idIndex = params.length - 1;
  const clientIndex = params.length;
  if (expected_updated_at) params.push(expected_updated_at);
  const versionIndex = params.length;
  const rows = (await sql(
    `UPDATE public.product_variants SET ${sets.join(', ')}
     WHERE id = $${idIndex}::uuid AND client_id = $${clientIndex}::uuid${expected_updated_at ? ` AND updated_at = $${versionIndex}::timestamptz` : ''}
     RETURNING ${rowFields()}`,
    params,
  )) as Array<Record<string, unknown>>;
  if (!rows[0]) {
    if (expected_updated_at) return jsonError(409, 'stale_variant', { current_updated_at: current[0].updated_at });
    return jsonError(404, 'not_found');
  }
  await logAudit(sql, {
    session: a.session, op: 'products.variant_updated', clientId: a.clientId,
    targetType: 'product_variant', targetId: id, detail: v,
  });
  return jsonOk(rows[0]);
}
