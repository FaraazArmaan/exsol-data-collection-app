// POST /api/u-products-import           — commit
// POST /api/u-products-import?dry_run=1 — preview only (no writes)
//
// Accepts multipart/form-data with field `file` (CSV or XLSX).
// Permission gate: products.products.create is required (covers creating new
// rows). Updates (existing SKU match) ALSO require products.products.edit;
// caller without that flag gets a per-row error on update rows but still gets
// to create new ones.
//
// Categories that don't yet exist are auto-created when the caller has the
// .create permission (same flag — categories CRUD piggybacks on the products
// verb set per the type-system constraints).

import type { Context } from '@netlify/functions';
import { db } from './_shared/db';
import { jsonError, jsonOk } from './_shared/http';
import { authenticateForPermission, resolveClientIdOrRespond } from './_shared/permissions';
import { logAudit } from './_shared/audit';
import { parseCsvBytes, type ParsedImportRow } from './_shared/products-import-parse';

interface ValidEntry {
  row: number;
  name: string;
  action: 'create' | 'update';
  id?: string;
  _row: ParsedImportRow;
}

export default async (req: Request, _ctx: Context) => {
  if (req.method !== 'POST') return jsonError(405, 'method_not_allowed');

  const auth = await authenticateForPermission(req, 'products.products.create');
  if (auth instanceof Response) return auth;
  const session = auth;
  const scope = resolveClientIdOrRespond(session, req);
  if (scope instanceof Response) return scope;
  const { clientId } = scope;

  const dryRun = new URL(req.url).searchParams.get('dry_run') === 'true' || new URL(req.url).searchParams.get('dry_run') === '1';

  let form: FormData;
  try { form = await req.formData(); } catch { return jsonError(400, 'invalid_multipart'); }
  const file = form.get('file');
  if (!(file instanceof Blob)) return jsonError(400, 'file_required');
  const buf = Buffer.from(await file.arrayBuffer());

  const parsed = parseCsvBytes(buf);

  // Caller's effective perms — we already have .create. Check .edit lazily for updates.
  // requirePermission validates one key at a time; piggyback off the matrix via a side query.
  let canEdit = false;
  if (session.kind === 'admin') canEdit = true;
  else {
    // L1 bypasses the matrix entirely; otherwise check the JSONB.
    if (session.level_number === 1) canEdit = true;
    else {
      const sql = db();
      const r = (await sql`
        SELECT permissions FROM public.client_levels
        WHERE client_id = ${clientId}::uuid AND level_number = ${session.level_number}
        LIMIT 1
      `) as Array<{ permissions: Record<string, true> | null }>;
      canEdit = Boolean(r[0]?.permissions?.['products.products.edit']);
    }
  }

  const sql = db();
  const existingCats = (await sql`
    SELECT id, name FROM public.product_categories
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
  `) as Array<{ id: string; name: string }>;
  const catByName = new Map<string, string>(existingCats.map((c) => [c.name.toLowerCase(), c.id]));

  const existingProducts = (await sql`
    SELECT id, sku, name, type FROM public.products
    WHERE client_id = ${clientId}::uuid AND deleted_at IS NULL
  `) as Array<{ id: string; sku: string | null; name: string; type: string }>;
  const skuToId = new Map<string, string>();
  const nameTypeToId = new Map<string, string>();
  for (const p of existingProducts) {
    if (p.sku) skuToId.set(p.sku.toLowerCase(), p.id);
    nameTypeToId.set(`${p.type}:${p.name.toLowerCase()}`, p.id);
  }

  const errors: Array<{ row: number; field?: string; message: string }> = [];
  const warnings: Array<{ row: number; message: string }> = [];
  const valid: ValidEntry[] = [];
  const catsToCreate = new Set<string>();
  let to_create = 0;
  let to_update = 0;

  for (const r of parsed.rows) {
    for (const e of r.errors) errors.push({ row: r.row_index, field: e.field, message: e.message });

    // Category resolution
    if (r.category_name) {
      const existing = catByName.get(r.category_name.toLowerCase());
      if (!existing) {
        // Will need to be created — caller has .create (they're here), so OK to auto-create.
        catsToCreate.add(r.category_name);
        warnings.push({ row: r.row_index, message: `category '${r.category_name}' will be auto-created` });
      }
    }

    // Phase B: warn if sale_price set without a sale window.
    if (r.sale_price_cents != null && r.sale_starts_at == null) {
      warnings.push({ row: r.row_index, message: 'sale price set but no sale window — will apply immediately' });
    }

    if (r.errors.length > 0) continue;

    // Determine action: create vs update
    let action: 'create' | 'update' = 'create';
    let existingId: string | undefined;
    if (r.sku && skuToId.has(r.sku.toLowerCase())) {
      action = 'update'; existingId = skuToId.get(r.sku.toLowerCase());
    } else if (!r.sku && nameTypeToId.has(`${r.type}:${r.name.toLowerCase()}`)) {
      action = 'update'; existingId = nameTypeToId.get(`${r.type}:${r.name.toLowerCase()}`);
    }

    if (action === 'update' && !canEdit) {
      errors.push({ row: r.row_index, field: 'sku', message: 'update requires products.products.edit' });
      continue;
    }

    valid.push({ row: r.row_index, name: r.name, action, ...(existingId ? { id: existingId } : {}), _row: r });
    if (action === 'create') to_create++; else to_update++;
  }

  const summary = { to_create, to_update, errors: errors.length, warnings: warnings.length };
  const validPayload = valid.map(({ _row, ...v }) => v);

  if (dryRun) {
    return jsonOk({ valid: validPayload, errors, warnings, summary });
  }
  if (errors.length > 0) {
    return jsonOk({ valid: validPayload, errors, warnings, summary, committed: false });
  }

  // COMMIT
  for (const name of catsToCreate) {
    const ins = (await sql`
      INSERT INTO public.product_categories (client_id, name)
      VALUES (${clientId}::uuid, ${name})
      ON CONFLICT DO NOTHING
      RETURNING id, name
    `) as Array<{ id: string; name: string }>;
    if (ins[0]) catByName.set(name.toLowerCase(), ins[0].id);
    else {
      const r2 = (await sql`
        SELECT id FROM public.product_categories
        WHERE client_id = ${clientId}::uuid AND name = ${name} AND deleted_at IS NULL LIMIT 1
      `) as Array<{ id: string }>;
      if (r2[0]) catByName.set(name.toLowerCase(), r2[0].id);
    }
  }

  const createdIds: string[] = [];
  const updatedIds: string[] = [];
  const userNodeId = session.kind === 'bucket_user' ? session.user_node_id : null;

  for (const v of valid) {
    const r = v._row;
    const category_id = r.category_name ? catByName.get(r.category_name.toLowerCase()) ?? null : null;
    if (v.action === 'create') {
      const ins = (await sql`
        INSERT INTO public.products (
          client_id, type, name, description, category_id, brand, tags,
          price_cents, sku, stock_qty, unit, status, created_by_user_node,
          gtin, mpn, condition, availability,
          sale_price_cents, sale_starts_at, sale_ends_at,
          weight_grams, length_mm, width_mm, height_mm,
          color, size, material, gender, age_group,
          manufacturer, country_of_origin, hsn_code, gst_rate,
          google_category, meta_category, product_url
        ) VALUES (
          ${clientId}::uuid, ${r.type}, ${r.name}, ${r.description},
          ${category_id}::uuid, ${r.brand}, ${r.tags}::text[], ${r.price_cents},
          ${r.sku}, ${r.stock_qty}, ${r.unit}, ${r.status}, ${userNodeId}::uuid,
          ${r.gtin}, ${r.mpn},
          ${r.condition ?? 'new'}, ${r.availability ?? 'in_stock'},
          ${r.sale_price_cents}, ${r.sale_starts_at}::timestamptz, ${r.sale_ends_at}::timestamptz,
          ${r.weight_grams}, ${r.length_mm}, ${r.width_mm}, ${r.height_mm},
          ${r.color}, ${r.size}, ${r.material}, ${r.gender}, ${r.age_group},
          ${r.manufacturer}, ${r.country_of_origin}, ${r.hsn_code}, ${r.gst_rate},
          ${r.google_category}, ${r.meta_category}, ${r.product_url}
        ) RETURNING id
      `) as Array<{ id: string }>;
      createdIds.push(ins[0]!.id);
    } else if (v.id) {
      await sql`
        UPDATE public.products SET
          type        = ${r.type}::product_type,
          name        = ${r.name},
          description = ${r.description},
          category_id = ${category_id}::uuid,
          brand       = ${r.brand},
          tags        = ${r.tags}::text[],
          price_cents = ${r.price_cents},
          sku         = ${r.sku},
          stock_qty   = ${r.stock_qty},
          unit        = ${r.unit},
          status      = ${r.status}::product_status,
          updated_at  = now()
        WHERE id = ${v.id}::uuid AND client_id = ${clientId}::uuid
      `;
      updatedIds.push(v.id);
    }
  }

  await logAudit(sql, {
    session, op: 'products.imported',
    clientId, targetType: 'product', targetId: clientId,
    detail: { created: createdIds.length, updated: updatedIds.length },
  });

  return jsonOk({
    valid: validPayload, errors, warnings, summary,
    committed: true, created_ids: createdIds, updated_ids: updatedIds,
  });
};
