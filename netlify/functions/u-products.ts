// /api/u-products      — GET (list w/ filters, search, paging, counts), POST (create)
//
// Workspace-scoped. All filters except `status` are AND'ed together and reused
// for the tab counts query, so the count badges show what's available at each
// status under the active filter set (Shopify-style).

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { parseCreateProduct } from './_shared/products-validate';

const CreateBody = z.object({
  type: z.enum(['physical', 'service']),
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  brand: z.string().max(120).nullable().optional(),
  tags: z.array(z.string()).max(32).optional(),
  price_cents: z.number().int().min(0),
  sku: z.string().max(80).nullable().optional(),
  stock_qty: z.number().int().min(0).nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  status: z.enum(['active', 'draft', 'archived']).optional(),
});

const SORT_COLUMNS = new Set(['created_at', 'name', 'price_cents']);

export default async (req: Request, _ctx: Context) => {
  if (req.method === 'GET')  return handleList(req);
  if (req.method === 'POST') return handleCreate(req);
  return jsonError(405, 'method_not_allowed');
};

async function handleList(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, 'products.products.view');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const url = new URL(req.url);
  const status      = url.searchParams.get('status');
  const type        = url.searchParams.get('type');
  const category_id = url.searchParams.get('category_id');
  const brand       = url.searchParams.get('brand');
  const q           = url.searchParams.get('q');
  const tags        = url.searchParams.getAll('tag');
  const page        = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const page_size   = Math.min(100, Math.max(1, parseInt(url.searchParams.get('page_size') ?? '20', 10) || 20));
  const sortParam   = url.searchParams.get('sort') ?? 'created_at';
  const sort        = SORT_COLUMNS.has(sortParam) ? sortParam : 'created_at';
  const order       = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';

  // Validate enum-ish inputs early.
  if (type && type !== 'physical' && type !== 'service') return jsonError(400, 'invalid_type');
  if (status && status !== 'all' && status !== 'active' && status !== 'draft' && status !== 'archived') return jsonError(400, 'invalid_status');

  const sql = db();
  const tagArr = tags.length === 0 ? null : tags;
  const statusFilter = status === 'all' || !status ? null : status;
  const qLike = q ? `%${q.toLowerCase()}%` : null;

  // Counts — uses the base filter set EXCEPT status (so tab badges show what
  // status options are reachable under the active filters).
  const countsRows = (await sql`
    SELECT
      COUNT(*)::int                                            AS all,
      COUNT(*) FILTER (WHERE status = 'active')::int           AS active,
      COUNT(*) FILTER (WHERE status = 'draft')::int            AS draft,
      COUNT(*) FILTER (WHERE status = 'archived')::int         AS archived
    FROM public.products
    WHERE client_id = ${clientId}::uuid
      AND deleted_at IS NULL
      AND (${type}::product_type IS NULL OR type = ${type}::product_type)
      AND (${category_id}::uuid    IS NULL OR category_id = ${category_id}::uuid)
      AND (${brand}::text          IS NULL OR brand = ${brand}::text)
      AND (${qLike}::text          IS NULL OR (
        lower(name) LIKE ${qLike} OR
        lower(coalesce(sku, '')) LIKE ${qLike} OR
        lower(coalesce(brand, '')) LIKE ${qLike}
      ))
      AND (${tagArr}::text[]       IS NULL OR tags @> ${tagArr}::text[])
  `) as Array<{ all: number; active: number; draft: number; archived: number }>;
  const counts = countsRows[0] ?? { all: 0, active: 0, draft: 0, archived: 0 };

  // Items — same WHERE plus optional status.
  // Cannot parameterize ORDER BY column name; sort/order pre-validated against
  // a whitelist (SORT_COLUMNS / ASC|DESC) so direct string interpolation
  // below cannot be exploited.
  const items = (await sql(
    `SELECT p.id, p.type, p.name, p.description, p.category_id, p.brand, p.tags, p.price_cents, p.currency,
            p.sku, p.stock_qty, p.unit, p.status, p.hero_image_key, pi_hero.id AS hero_image_id,
            p.created_at, p.updated_at
     FROM public.products p
     LEFT JOIN public.product_images pi_hero
       ON pi_hero.product_id = p.id AND pi_hero.blob_key = p.hero_image_key
     WHERE p.client_id = $1::uuid
       AND p.deleted_at IS NULL
       AND ($2::product_type IS NULL OR p.type = $2::product_type)
       AND ($3::uuid IS NULL OR p.category_id = $3::uuid)
       AND ($4::text IS NULL OR p.brand = $4::text)
       AND ($5::text IS NULL OR (
         lower(p.name) LIKE $5 OR lower(coalesce(p.sku,'')) LIKE $5 OR lower(coalesce(p.brand,'')) LIKE $5
       ))
       AND ($6::text[] IS NULL OR p.tags @> $6::text[])
       AND ($7::product_status IS NULL OR p.status = $7::product_status)
     ORDER BY p.${sort} ${order}
     LIMIT $8 OFFSET $9`,
    [clientId, type, category_id, brand, qLike, tagArr, statusFilter, page_size, (page - 1) * page_size],
  )) as Array<Record<string, unknown>>;

  const totalRows = (await sql`
    SELECT COUNT(*)::int AS total FROM public.products
    WHERE client_id = ${clientId}::uuid
      AND deleted_at IS NULL
      AND (${type}::product_type IS NULL OR type = ${type}::product_type)
      AND (${category_id}::uuid    IS NULL OR category_id = ${category_id}::uuid)
      AND (${brand}::text          IS NULL OR brand = ${brand}::text)
      AND (${qLike}::text          IS NULL OR (
        lower(name) LIKE ${qLike} OR
        lower(coalesce(sku, '')) LIKE ${qLike} OR
        lower(coalesce(brand, '')) LIKE ${qLike}
      ))
      AND (${tagArr}::text[]       IS NULL OR tags @> ${tagArr}::text[])
      AND (${statusFilter}::product_status IS NULL OR status = ${statusFilter}::product_status)
  `) as Array<{ total: number }>;
  const total = totalRows[0]?.total ?? 0;

  return jsonOk({ items, total, page, page_size, counts });
}

async function handleCreate(req: Request): Promise<Response> {
  const auth = await authenticateForPermission(req, 'products.products.create');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const body = await req.json().catch(() => null);
  const zod = CreateBody.safeParse(body);
  if (!zod.success) return jsonError(400, 'validation_failed', zod.error.flatten());

  // Re-run our richer type-field validation (service/physical mismatch).
  const parsed = parseCreateProduct(zod.data);
  if (!parsed.ok) return jsonError(422, 'invalid_input', parsed.errors);

  const v = parsed.value;
  const sql = db();
  const userNodeId = session.kind === 'bucket_user' ? session.user_node_id : null;

  // SKU uniqueness (physical only)
  if (v.type === 'physical' && v.sku) {
    const dup = (await sql`
      SELECT id FROM public.products
      WHERE client_id = ${clientId}::uuid AND sku = ${v.sku} AND deleted_at IS NULL LIMIT 1
    `) as Array<{ id: string }>;
    if (dup.length) return jsonError(409, 'sku_in_use');
  }

  try {
    const rows = (await sql`
      INSERT INTO public.products (
        client_id, type, name, description, category_id, brand, tags,
        price_cents, sku, stock_qty, unit, status, created_by_user_node
      ) VALUES (
        ${clientId}::uuid, ${v.type}, ${v.name}, ${v.description ?? null},
        ${v.category_id ?? null}::uuid, ${v.brand ?? null},
        ${v.tags ?? []}::text[], ${v.price_cents},
        ${v.sku ?? null}, ${v.stock_qty ?? null}, ${v.unit ?? null},
        ${v.status ?? 'draft'}, ${userNodeId}::uuid
      )
      RETURNING id, type, name, description, category_id, brand, tags, price_cents, currency,
                sku, stock_qty, unit, status, hero_image_key, created_at, updated_at
    `) as Array<{ id: string }>;
    const product = rows[0]!;
    await logAudit(sql, {
      session, op: 'products.created',
      clientId, targetType: 'product', targetId: product.id,
      detail: { type: v.type, name: v.name },
    });
    return jsonOk(product, { status: 201 });
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if (code === '23503') return jsonError(404, 'category_not_found');
    throw e;
  }
}
