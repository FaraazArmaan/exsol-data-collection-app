// /api/u-product-categories            — GET (list), POST (create)
// /api/u-product-categories/:id        — PATCH (rename / reorder), DELETE (soft)
//
// Workspace-scoped: bucket-user JWT only (admins are blocked).
// Permission gates via the existing matrix:
//   GET    → products.products.view
//   POST   → products.products.create
//   PATCH  → products.products.edit
//   DELETE → products.products.delete
//
// Deleting a category soft-deletes it AND nulls products.category_id for every
// referencing product (the FK is ON DELETE SET NULL but we're soft-deleting, so
// the cascade doesn't fire — we do it explicitly).

import type { Context } from '@netlify/functions';
import { z } from 'zod';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idFromUrl(req: Request): string | null {
  const m = new URL(req.url).pathname.match(/u-product-categories\/([^/?]+)/);
  return m && UUID.test(m[1]!) ? m[1]! : null;
}

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  sort_order: z.number().int().optional(),
});

const PatchBody = z.object({
  name: z.string().min(1).max(80).optional(),
  sort_order: z.number().int().optional(),
}).refine((v) => v.name !== undefined || v.sort_order !== undefined, {
  message: 'at least one field required',
});

export default async (req: Request, _ctx: Context) => {
  const id = idFromUrl(req);
  const permKey =
    req.method === 'GET'    ? 'products.products.view'   :
    req.method === 'POST'   ? 'products.products.create' :
    req.method === 'PATCH'  ? 'products.products.edit'   :
    req.method === 'DELETE' ? 'products.products.delete' : null;
  if (!permKey) return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, permKey);
  if (auth instanceof Response) return auth;
  const session = auth;

  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const sql = db();

  // -------- list --------
  if (req.method === 'GET') {
    const rows = (await sql`
      SELECT id, name, sort_order, created_at, updated_at
      FROM public.product_categories
      WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
      ORDER BY sort_order ASC, name ASC
    `) as Array<{ id: string; name: string; sort_order: number; created_at: string; updated_at: string }>;
    return jsonOk({ items: rows });
  }

  // -------- create --------
  if (req.method === 'POST') {
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    try {
      const rows = (await sql`
        INSERT INTO public.product_categories (client_id, name, sort_order)
        VALUES (${clientId}::uuid, ${parsed.data.name}, ${parsed.data.sort_order ?? 0})
        RETURNING id, name, sort_order, created_at, updated_at
      `) as Array<{ id: string }>;
      const cat = rows[0]!;
      await logAudit(sql, {
        session, op: 'product_categories.created',
        clientId, targetType: 'product_category', targetId: cat.id,
        detail: { name: parsed.data.name },
      });
      return jsonOk(cat, { status: 201 });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === '23505') return jsonError(409, 'duplicate_name');
      if ((e as { code?: string })?.code === '23503') return jsonError(404, 'client_not_found');
      throw e;
    }
  }

  // From here on, we need :id
  if (!id) return jsonError(400, 'invalid_id');

  // -------- patch --------
  if (req.method === 'PATCH') {
    const parsed = PatchBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, 'validation_failed', parsed.error.flatten());
    try {
      const rows = (await sql`
        UPDATE public.product_categories
        SET name       = COALESCE(${parsed.data.name ?? null}, name),
            sort_order = COALESCE(${parsed.data.sort_order ?? null}, sort_order),
            updated_at = now()
        WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL
        RETURNING id, name, sort_order, created_at, updated_at
      `) as Array<{ id: string; name: string }>;
      if (rows.length === 0) return jsonError(404, 'not_found');
      await logAudit(sql, {
        session, op: 'product_categories.updated',
        clientId, targetType: 'product_category', targetId: id,
        detail: parsed.data as Record<string, unknown>,
      });
      return jsonOk(rows[0]!);
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === '23505') return jsonError(409, 'duplicate_name');
      throw e;
    }
  }

  // -------- delete --------
  if (req.method === 'DELETE') {
    const rows = (await sql`
      UPDATE public.product_categories
      SET deleted_at = now()
      WHERE id = ${id}::uuid AND client_id = ${clientId}::uuid AND deleted_at IS NULL
      RETURNING id
    `) as Array<{ id: string }>;
    if (rows.length === 0) return jsonError(404, 'not_found');
    // Soft-delete: null out the FK on every referencing product so the UI
    // shows "(no category)" rather than a broken reference.
    await sql`
      UPDATE public.products
      SET category_id = NULL, updated_at = now()
      WHERE category_id = ${id}::uuid AND deleted_at IS NULL
    `;
    await logAudit(sql, {
      session, op: 'product_categories.deleted',
      clientId, targetType: 'product_category', targetId: id,
      detail: null,
    });
    return new Response(null, { status: 204 });
  }

  return jsonError(405, 'method_not_allowed');
};
