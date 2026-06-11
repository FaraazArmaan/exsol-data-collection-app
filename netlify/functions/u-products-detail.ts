// /api/u-products/:id  — GET (with images), PATCH, DELETE (soft).
//
// Permission gates:
//   GET    → products.products.view
//   PATCH  → products.products.edit
//   DELETE → products.products.delete
//
// PATCH builds a dynamic SET clause from supplied fields, validates the
// resulting (type + sku/stock/unit) combo, enforces SKU uniqueness, and
// emits granular audit ops (products.updated plus optional .status_changed
// / .category_changed) when those columns flip.

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { validateTypeFields } from './_shared/products-validate';
import { computeSalePrice } from './_shared/products-discount';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/u-products(?:-detail)?\/([^/?]+)/);
  return m && UUID_RE.test(m[1]!) ? m[1]! : null;
}

const PatchBody = z.object({
  type: z.enum(['physical', 'service']).optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  tags: z.array(z.string()).max(32).optional(),
  price_cents: z.number().int().min(0).optional(),
  sku: z.string().max(80).nullable().optional(),
  stock_qty: z.number().int().min(0).nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
  hero_image_key: z.string().max(500).nullable().optional(),

  // Phase B
  gtin: z.string().max(40).nullable().optional(),
  mpn: z.string().max(80).nullable().optional(),
  condition: z.enum(['new', 'refurbished', 'used']).optional(),
  availability: z.enum(['in_stock', 'out_of_stock', 'preorder', 'discontinued']).optional(),
  discount_percent: z.number().nullable().optional(),
  sale_price_cents: z.number().int().min(0).nullable().optional(),
  sale_starts_at: z.string().datetime().nullable().optional(),
  sale_ends_at: z.string().datetime().nullable().optional(),
  weight_grams: z.number().int().min(0).nullable().optional(),
  length_mm: z.number().int().min(0).nullable().optional(),
  width_mm: z.number().int().min(0).nullable().optional(),
  height_mm: z.number().int().min(0).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  size: z.string().max(40).nullable().optional(),
  material: z.string().max(80).nullable().optional(),
  gender: z.string().max(20).nullable().optional(),
  age_group: z.string().max(20).nullable().optional(),
  manufacturer: z.string().max(120).nullable().optional(),
  country_of_origin: z.string().max(80).nullable().optional(),
  hsn_code: z.string().max(20).nullable().optional(),
  gst_rate: z.number().min(0).max(100).nullable().optional(),
  google_category: z.string().max(120).nullable().optional(),
  meta_category: z.string().max(120).nullable().optional(),
  product_url: z.string().url().max(500).nullable().optional(),
  platform_extras: z.record(z.unknown()).optional(),
}).refine((v) => Object.keys(v).length > 0, { message: 'empty patch' });

export default async (req: Request, _ctx: Context) => {
  const id = idFromUrl(req);
  if (!id) return jsonError(400, 'invalid_id');

  if (req.method === 'GET')    return handleGet(req, id);
  if (req.method === 'PATCH')  return handlePatch(req, id);
  if (req.method === 'DELETE') return handleDelete(req, id);
  return jsonError(405, 'method_not_allowed');
};

async function handleGet(req: Request, id: string): Promise<Response> {
  const auth = await authenticateForPermission(req, 'products.products.view');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;

  const sql = db();
  const rows = (await sql`
    SELECT p.id, p.type, p.name, p.description, p.category_id, p.brand, p.tags, p.price_cents, p.currency,
           p.sku, p.stock_qty, p.unit, p.status, p.hero_image_key, pi_hero.id AS hero_image_id,
           p.created_at, p.updated_at,
           p.gtin, p.mpn, p.condition, p.availability,
           p.sale_price_cents, p.sale_starts_at, p.sale_ends_at,
           p.weight_grams, p.length_mm, p.width_mm, p.height_mm,
           p.color, p.size, p.material, p.gender, p.age_group,
           p.manufacturer, p.country_of_origin, p.hsn_code, p.gst_rate,
           p.google_category, p.meta_category, p.product_url, p.platform_extras
    FROM public.products p
    LEFT JOIN public.product_images pi_hero
      ON pi_hero.product_id = p.id AND pi_hero.blob_key = p.hero_image_key
    WHERE p.id = ${id}::uuid AND p.client_id = ${scope.clientId}::uuid AND p.deleted_at IS NULL
    LIMIT 1
  `) as Array<Record<string, unknown>>;
  if (rows.length === 0) return jsonError(404, 'not_found');

  const images = (await sql`
    SELECT id, blob_key, sort_order
    FROM public.product_images
    WHERE product_id = ${id}::uuid
    ORDER BY sort_order ASC
  `) as Array<{ id: string; blob_key: string; sort_order: number }>;

  return jsonOk({ ...rows[0], images });
}

async function handlePatch(req: Request, id: string): Promise<Response> {
  const auth = await authenticateForPermission(req, 'products.products.edit');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
  const v = parsed.data;

  if (v.discount_percent != null && (v.discount_percent <= 0 || v.discount_percent >= 100)) {
    return jsonError(400, 'discount_percent_invalid', 'must be > 0 and < 100');
  }

  const sql = db();
  const cur = (await sql`
    SELECT type, status, category_id, price_cents, discount_percent FROM public.products
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `) as Array<{ type: 'physical' | 'service'; status: string; category_id: string | null; price_cents: number; discount_percent: string | null }>;
  if (cur.length === 0) return jsonError(404, 'not_found');

  const oldPrice = cur[0]!.price_cents as number;
  const oldDiscount = cur[0]!.discount_percent == null
    ? null
    : Number(cur[0]!.discount_percent);

  const effectiveType = v.type ?? cur[0]!.type;
  const tErrs = validateTypeFields({ type: effectiveType, sku: v.sku, stock_qty: v.stock_qty, unit: v.unit });
  if (tErrs.length) return jsonError(422, 'invalid_input', tErrs);

  // SKU uniqueness (skip self).
  if (v.sku !== undefined && v.sku !== null && v.sku !== '') {
    const dup = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${clientId}::uuid AND sku = ${v.sku}
        AND deleted_at IS NULL AND id <> ${id}::uuid LIMIT 1
    `) as Array<{ id: string }>;
    if (dup.length) return jsonError(409, 'sku_in_use');
  }

  // Build dynamic UPDATE: only set fields present in v.
  const sets: string[] = [];
  const params: unknown[] = [];
  function setField(col: string, value: unknown, cast?: string): void {
    params.push(value);
    sets.push(`${col} = $${params.length}${cast ? `::${cast}` : ''}`);
  }

  if (v.type           !== undefined) setField('type',           v.type,           'product_type');
  if (v.name           !== undefined) setField('name',           v.name);
  if (v.description    !== undefined) setField('description',    v.description);
  if (v.category_id    !== undefined) setField('category_id',    v.category_id,    'uuid');
  if (v.brand          !== undefined) setField('brand',          v.brand);
  if (v.tags           !== undefined) setField('tags',           v.tags,           'text[]');
  if (v.price_cents    !== undefined) setField('price_cents',    v.price_cents);
  if (v.sku            !== undefined) setField('sku',            v.sku);
  if (v.stock_qty      !== undefined) setField('stock_qty',      v.stock_qty);
  if (v.unit           !== undefined) setField('unit',           v.unit);
  if (v.status         !== undefined) setField('status',         v.status,         'product_status');
  if (v.hero_image_key !== undefined) setField('hero_image_key', v.hero_image_key);

  // Phase B platform fields
  if (v.gtin              !== undefined) setField('gtin',              v.gtin);
  if (v.mpn               !== undefined) setField('mpn',               v.mpn);
  if (v.condition         !== undefined) setField('condition',         v.condition);
  if (v.availability      !== undefined) setField('availability',      v.availability);
  // Compute post-patch discount + price.
  const postDiscount = v.discount_percent !== undefined ? v.discount_percent : oldDiscount;
  const postPrice    = v.price_cents      !== undefined ? v.price_cents      : oldPrice;

  // Rule #5: sale_price_cents alone (no discount_percent key in payload) on a row
  // whose post-patch state still has a discount → reject.
  if (
    v.sale_price_cents !== undefined &&
    v.discount_percent === undefined &&
    postDiscount != null
  ) {
    return jsonError(400, 'sale_price_locked_by_discount', 'clear discount_percent before editing sale_price_cents');
  }

  // SET discount_percent if present in the patch.
  if (v.discount_percent !== undefined) setField('discount_percent', v.discount_percent);

  // SET sale_price_cents per the rules:
  //   - postDiscount != null → always set the computed value
  //   - postDiscount == null and v.sale_price_cents !== undefined → honor freeform value
  //   - postDiscount == null and v.sale_price_cents === undefined → no change
  if (postDiscount != null) {
    const computed = computeSalePrice(postPrice, postDiscount);
    setField('sale_price_cents', computed);
  } else if (v.sale_price_cents !== undefined) {
    setField('sale_price_cents', v.sale_price_cents);
  }
  if (v.sale_starts_at    !== undefined) setField('sale_starts_at',    v.sale_starts_at,   'timestamptz');
  if (v.sale_ends_at      !== undefined) setField('sale_ends_at',      v.sale_ends_at,     'timestamptz');
  if (v.weight_grams      !== undefined) setField('weight_grams',      v.weight_grams);
  if (v.length_mm         !== undefined) setField('length_mm',         v.length_mm);
  if (v.width_mm          !== undefined) setField('width_mm',          v.width_mm);
  if (v.height_mm         !== undefined) setField('height_mm',         v.height_mm);
  if (v.color             !== undefined) setField('color',             v.color);
  if (v.size              !== undefined) setField('size',              v.size);
  if (v.material          !== undefined) setField('material',          v.material);
  if (v.gender            !== undefined) setField('gender',            v.gender);
  if (v.age_group         !== undefined) setField('age_group',         v.age_group);
  if (v.manufacturer      !== undefined) setField('manufacturer',      v.manufacturer);
  if (v.country_of_origin !== undefined) setField('country_of_origin', v.country_of_origin);
  if (v.hsn_code          !== undefined) setField('hsn_code',          v.hsn_code);
  if (v.gst_rate          !== undefined) setField('gst_rate',          v.gst_rate);
  if (v.google_category   !== undefined) setField('google_category',   v.google_category);
  if (v.meta_category     !== undefined) setField('meta_category',     v.meta_category);
  if (v.product_url       !== undefined) setField('product_url',       v.product_url);
  if (v.platform_extras   !== undefined) setField('platform_extras',   JSON.stringify(v.platform_extras), 'jsonb');

  if (sets.length === 0) return jsonError(400, 'empty_patch');

  // Append id + clientId for the WHERE clause.
  params.push(id);
  const idIdx = params.length;
  params.push(clientId);
  const cidIdx = params.length;

  try {
    const rows = (await sql(
      `UPDATE public.products
         SET ${sets.join(', ')}, updated_at = now()
       WHERE id = $${idIdx}::uuid AND client_id = $${cidIdx}::uuid AND deleted_at IS NULL
       RETURNING id, type, name, description, category_id, brand, tags, price_cents, currency,
                 sku, stock_qty, unit, status, hero_image_key, created_at, updated_at,
                 gtin, mpn, condition, availability,
                 discount_percent, sale_price_cents, sale_starts_at, sale_ends_at,
                 weight_grams, length_mm, width_mm, height_mm,
                 color, size, material, gender, age_group,
                 manufacturer, country_of_origin, hsn_code, gst_rate,
                 google_category, meta_category, product_url, platform_extras`,
      params,
    )) as Array<Record<string, unknown>>;
    if (rows.length === 0) return jsonError(404, 'not_found');

    await logAudit(sql, {
      session, op: 'products.updated',
      clientId, targetType: 'product', targetId: id,
      detail: {
        ...(v as Record<string, unknown>),
        ...(v.discount_percent !== undefined && v.discount_percent !== oldDiscount ? {
          discount_percent_changed_from: oldDiscount,
          discount_percent_changed_to: v.discount_percent,
        } : {}),
      },
    });
    if (v.status && v.status !== cur[0]!.status) {
      await logAudit(sql, {
        session, op: 'products.status_changed',
        clientId, targetType: 'product', targetId: id,
        detail: { from: cur[0]!.status, to: v.status },
      });
    }
    if (v.category_id !== undefined && v.category_id !== cur[0]!.category_id) {
      await logAudit(sql, {
        session, op: 'products.category_changed',
        clientId, targetType: 'product', targetId: id,
        detail: { from: cur[0]!.category_id, to: v.category_id },
      });
    }

    return jsonOk(rows[0]!);
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23503') return jsonError(404, 'category_not_found');
    if (code === '23505') return jsonError(409, 'sku_in_use');
    throw e;
  }
}

async function handleDelete(req: Request, id: string): Promise<Response> {
  const auth = await authenticateForPermission(req, 'products.products.delete');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;

  const sql = db();
  const rows = (await sql`
    UPDATE public.products SET deleted_at = now()
    WHERE id = ${id}::uuid AND client_id = ${scope.clientId}::uuid AND deleted_at IS NULL
    RETURNING id
  `) as Array<{ id: string }>;
  if (rows.length === 0) return jsonError(404, 'not_found');

  await logAudit(sql, {
    session, op: 'products.archived',
    clientId: scope.clientId, targetType: 'product', targetId: id,
    detail: null,
  });
  return new Response(null, { status: 204 });
}
