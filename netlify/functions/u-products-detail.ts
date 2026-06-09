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
           p.created_at, p.updated_at
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

  const sql = db();
  const cur = (await sql`
    SELECT type, status, category_id FROM public.products
    WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL
    LIMIT 1
  `) as Array<{ type: 'physical' | 'service'; status: string; category_id: string | null }>;
  if (cur.length === 0) return jsonError(404, 'not_found');

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
                 sku, stock_qty, unit, status, hero_image_key, created_at, updated_at`,
      params,
    )) as Array<Record<string, unknown>>;
    if (rows.length === 0) return jsonError(404, 'not_found');

    await logAudit(sql, {
      session, op: 'products.updated',
      clientId, targetType: 'product', targetId: id,
      detail: v as Record<string, unknown>,
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
