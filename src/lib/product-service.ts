import { withTenantContext } from './tenancy.ts';
import { record as recordAudit } from './audit-log-writer.ts';
import type {
  ActorContext,
  Marketplace,
  ProductStatus,
  ProductType,
} from './types.ts';

export type ProductCore = {
  sku: string;
  name: string;
  description?: string | null;
  productType?: ProductType;
  categoryId?: string | null;
  subCategoryId?: string | null;
  primaryImageId?: string | null;
  extraImageIds?: string[];
  price: number;
  currency?: string;
  cost?: number | null;
  stockUnit?: string;
  weightG?: number | null;
  dimLMm?: number | null;
  dimWMm?: number | null;
  dimHMm?: number | null;
  barcode?: string | null;
  hsnCode?: string | null;
  gstRate?: number | null;
  foodFields?: Record<string, unknown> | null;
  tags?: string[];
  lowStockThreshold?: number | null;
  deadStockDays?: number | null;
  status?: ProductStatus;
};

export type ProductRow = ProductCore & {
  id: string;
  workspaceId: string;
  stockCount: number;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
};

export type OverlayRow = {
  marketplace: Marketplace;
  fields: Record<string, unknown>;
  enabled: boolean;
  lastSynced: Date | null;
};

export type ListFilters = {
  search?: string;
  status?: ProductStatus | null;
  categoryId?: string;
  marketplaceEnabled?: Marketplace;
  limit?: number;
  offset?: number;
};

export type ListResult = { products: ProductRow[]; total: number };

const VALID_MARKETPLACES: ReadonlySet<Marketplace> = new Set([
  'amazon',
  'flipkart',
  'meta',
  'wa',
  'rakuten',
  'aliexpress',
  'swiggy',
  'zomato',
]);

export async function listProducts(
  actor: ActorContext,
  filters: ListFilters = {},
): Promise<ListResult> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  const limit = clamp(filters.limit ?? 50, 1, 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const where: string[] = ['p.workspace_id = $1'];
      const params: unknown[] = [actor.workspaceId];
      let idx = 2;
      let joinClause = '';

      if (filters.search) {
        where.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx})`);
        params.push(`%${filters.search}%`);
        idx++;
      }
      if (filters.status) {
        where.push(`p.status = $${idx}`);
        params.push(filters.status);
        idx++;
      }
      if (filters.categoryId) {
        where.push(`(p.category_id = $${idx} OR p.sub_category_id = $${idx})`);
        params.push(filters.categoryId);
        idx++;
      }
      if (filters.marketplaceEnabled && VALID_MARKETPLACES.has(filters.marketplaceEnabled)) {
        joinClause = `JOIN product_marketplace_fields pmf
          ON pmf.product_id = p.id AND pmf.marketplace = $${idx} AND pmf.enabled = true`;
        params.push(filters.marketplaceEnabled);
        idx++;
      }

      const totalRes = await c.query(
        `SELECT count(*)::int AS n FROM products p ${joinClause} WHERE ${where.join(' AND ')}`,
        params,
      );

      const dataParams = [...params, limit, offset];
      const rowsRes = await c.query(
        `SELECT p.* FROM products p ${joinClause}
         WHERE ${where.join(' AND ')}
         ORDER BY p.updated_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        dataParams,
      );

      return {
        total: totalRes.rows[0].n as number,
        products: rowsRes.rows.map(rowToProduct),
      };
    },
  );
}

export type ProductDetail = {
  product: ProductRow;
  overlays: OverlayRow[];
};

export async function getProduct(
  actor: ActorContext,
  productId: string,
): Promise<ProductDetail | null> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const r = await c.query(`SELECT * FROM products WHERE id = $1`, [productId]);
      if ((r.rowCount ?? 0) === 0) return null;
      const product = rowToProduct(r.rows[0]);
      const o = await c.query(
        `SELECT marketplace, fields, enabled, last_synced
         FROM product_marketplace_fields WHERE product_id = $1`,
        [productId],
      );
      const overlays = o.rows.map((row) => ({
        marketplace: row.marketplace as Marketplace,
        fields: row.fields,
        enabled: row.enabled,
        lastSynced: row.last_synced,
      }));
      return { product, overlays };
    },
  );
}

export type CreateError =
  | { error: 'duplicate_sku' }
  | { error: 'invalid_input'; detail: string };

export async function createProduct(
  actor: ActorContext,
  input: ProductCore,
): Promise<ProductRow | CreateError> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  const validation = validateCore(input);
  if (validation) return { error: 'invalid_input', detail: validation };

  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      try {
        const r = await c.query(
          `INSERT INTO products (
             workspace_id, sku, name, description, product_type,
             category_id, sub_category_id,
             primary_image_id, extra_image_ids,
             price, currency, cost,
             stock_count, stock_unit,
             weight_g, dim_l_mm, dim_w_mm, dim_h_mm,
             barcode, hsn_code, gst_rate, food_fields, tags,
             low_stock_threshold, dead_stock_days, status,
             updated_by
           ) VALUES (
             $1, $2, $3, $4, COALESCE($5::product_type, 'physical_goods'::product_type),
             $6, $7,
             $8, COALESCE($9, '{}'::text[]),
             $10, COALESCE($11, 'INR'), $12,
             0, COALESCE($13, 'piece'),
             $14, $15, $16, $17,
             $18, $19, $20, $21::jsonb, COALESCE($22, '{}'::text[]),
             $23, $24, COALESCE($25::product_status, 'draft'::product_status),
             $26
           ) RETURNING *`,
          [
            actor.workspaceId,
            input.sku.trim(),
            input.name.trim(),
            input.description ?? null,
            input.productType ?? null,
            input.categoryId ?? null,
            input.subCategoryId ?? null,
            input.primaryImageId ?? null,
            input.extraImageIds ?? null,
            input.price,
            input.currency ?? null,
            input.cost ?? null,
            input.stockUnit ?? null,
            input.weightG ?? null,
            input.dimLMm ?? null,
            input.dimWMm ?? null,
            input.dimHMm ?? null,
            input.barcode ?? null,
            input.hsnCode ?? null,
            input.gstRate ?? null,
            input.foodFields == null ? null : JSON.stringify(input.foodFields),
            input.tags ?? null,
            input.lowStockThreshold ?? null,
            input.deadStockDays ?? null,
            input.status ?? null,
            actor.onBehalfOfId ?? actor.realActorId,
          ],
        );
        const product = rowToProduct(r.rows[0]);
        await recordAudit(
          {
            realActorId: actor.realActorId,
            onBehalfOfId: actor.onBehalfOfId ?? null,
            impersonationReason: actor.impersonationReason,
            workspaceId: actor.workspaceId,
            action: 'product.create',
            resourceType: 'product',
            resourceId: product.id,
            after: {
              sku: product.sku,
              name: product.name,
              price: product.price,
              status: product.status,
            },
          },
          c,
        );
        return product;
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e?.code === '23505') return { error: 'duplicate_sku' };
        throw err;
      }
    },
  );
}

export type BulkRowError = {
  row: number;
  error: 'invalid_input' | 'duplicate_sku';
  detail?: string;
};

export type BulkCreateResult = {
  created: ProductRow[];
  errors: BulkRowError[];
  summary: { total: number; succeeded: number; failed: number };
};

export async function bulkCreateProducts(
  actor: ActorContext,
  rows: ProductCore[],
): Promise<BulkCreateResult> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  const created: ProductRow[] = [];
  const errors: BulkRowError[] = [];

  if (rows.length === 0) {
    return { created, errors, summary: { total: 0, succeeded: 0, failed: 0 } };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const result = await createProduct(actor, row);
    if ('error' in result) {
      errors.push({
        row: i,
        error: result.error,
        detail: 'detail' in result ? result.detail : undefined,
      });
    } else {
      created.push(result);
    }
  }

  return {
    created,
    errors,
    summary: { total: rows.length, succeeded: created.length, failed: errors.length },
  };
}

export type UpdateError =
  | { error: 'duplicate_sku' }
  | { error: 'invalid_input'; detail: string }
  | { error: 'not_found' };

export async function updateProduct(
  actor: ActorContext,
  productId: string,
  patch: Partial<ProductCore>,
): Promise<ProductRow | UpdateError> {
  if (!actor.workspaceId) throw new Error('workspaceId required');

  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const beforeRes = await c.query(`SELECT * FROM products WHERE id = $1`, [productId]);
      if ((beforeRes.rowCount ?? 0) === 0) return { error: 'not_found' };
      const before = rowToProduct(beforeRes.rows[0]);

      const merged: ProductCore = { ...before, ...patch };
      const validation = validateCore(merged);
      if (validation) return { error: 'invalid_input', detail: validation };

      try {
        const r = await c.query(
          `UPDATE products SET
             sku = COALESCE($2, sku),
             name = COALESCE($3, name),
             description = $4,
             product_type = COALESCE($5::product_type, product_type),
             category_id = $6,
             sub_category_id = $7,
             primary_image_id = $8,
             extra_image_ids = COALESCE($9, extra_image_ids),
             price = COALESCE($10, price),
             currency = COALESCE($11, currency),
             cost = $12,
             stock_unit = COALESCE($13, stock_unit),
             weight_g = $14,
             dim_l_mm = $15,
             dim_w_mm = $16,
             dim_h_mm = $17,
             barcode = $18,
             hsn_code = $19,
             gst_rate = $20,
             food_fields = $21::jsonb,
             tags = COALESCE($22, tags),
             low_stock_threshold = $23,
             dead_stock_days = $24,
             status = COALESCE($25::product_status, status),
             updated_at = now(),
             updated_by = $26
           WHERE id = $1
           RETURNING *`,
          [
            productId,
            patch.sku !== undefined ? patch.sku.trim() : null,
            patch.name !== undefined ? patch.name.trim() : null,
            patch.description === undefined ? before.description ?? null : patch.description,
            patch.productType ?? null,
            patch.categoryId === undefined ? before.categoryId ?? null : patch.categoryId,
            patch.subCategoryId === undefined ? before.subCategoryId ?? null : patch.subCategoryId,
            patch.primaryImageId === undefined
              ? before.primaryImageId ?? null
              : patch.primaryImageId,
            patch.extraImageIds ?? null,
            patch.price ?? null,
            patch.currency ?? null,
            patch.cost === undefined ? before.cost ?? null : patch.cost,
            patch.stockUnit ?? null,
            patch.weightG === undefined ? before.weightG ?? null : patch.weightG,
            patch.dimLMm === undefined ? before.dimLMm ?? null : patch.dimLMm,
            patch.dimWMm === undefined ? before.dimWMm ?? null : patch.dimWMm,
            patch.dimHMm === undefined ? before.dimHMm ?? null : patch.dimHMm,
            patch.barcode === undefined ? before.barcode ?? null : patch.barcode,
            patch.hsnCode === undefined ? before.hsnCode ?? null : patch.hsnCode,
            patch.gstRate === undefined ? before.gstRate ?? null : patch.gstRate,
            patch.foodFields === undefined
              ? before.foodFields == null
                ? null
                : JSON.stringify(before.foodFields)
              : patch.foodFields == null
                ? null
                : JSON.stringify(patch.foodFields),
            patch.tags ?? null,
            patch.lowStockThreshold === undefined
              ? before.lowStockThreshold ?? null
              : patch.lowStockThreshold,
            patch.deadStockDays === undefined
              ? before.deadStockDays ?? null
              : patch.deadStockDays,
            patch.status ?? null,
            actor.onBehalfOfId ?? actor.realActorId,
          ],
        );
        const after = rowToProduct(r.rows[0]);
        await recordAudit(
          {
            realActorId: actor.realActorId,
            onBehalfOfId: actor.onBehalfOfId ?? null,
            impersonationReason: actor.impersonationReason,
            workspaceId: actor.workspaceId,
            action: 'product.update',
            resourceType: 'product',
            resourceId: productId,
            before: serializeForDiff(before),
            after: serializeForDiff(after),
          },
          c,
        );
        return after;
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e?.code === '23505') return { error: 'duplicate_sku' };
        throw err;
      }
    },
  );
}

export async function deleteProduct(
  actor: ActorContext,
  productId: string,
): Promise<{ deleted: true } | { error: 'not_found' }> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const beforeRes = await c.query(`SELECT * FROM products WHERE id = $1`, [productId]);
      if ((beforeRes.rowCount ?? 0) === 0) return { error: 'not_found' as const };
      const before = rowToProduct(beforeRes.rows[0]);

      await c.query(`DELETE FROM products WHERE id = $1`, [productId]);
      await recordAudit(
        {
          realActorId: actor.realActorId,
          onBehalfOfId: actor.onBehalfOfId ?? null,
          impersonationReason: actor.impersonationReason,
          workspaceId: actor.workspaceId,
          action: 'product.delete',
          resourceType: 'product',
          resourceId: productId,
          before: serializeForDiff(before),
          after: null,
        },
        c,
      );
      return { deleted: true as const };
    },
  );
}

export type OverlayInput = {
  fields: Record<string, unknown>;
  enabled: boolean;
};

export type OverlayError =
  | { error: 'invalid_marketplace' }
  | { error: 'invalid_fields' }
  | { error: 'not_found' };

export async function setMarketplaceOverlay(
  actor: ActorContext,
  productId: string,
  marketplace: string,
  input: OverlayInput,
): Promise<OverlayRow | OverlayError> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  if (!VALID_MARKETPLACES.has(marketplace as Marketplace)) {
    return { error: 'invalid_marketplace' };
  }
  if (typeof input.fields !== 'object' || input.fields === null) {
    return { error: 'invalid_fields' };
  }

  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const exists = await c.query(`SELECT 1 FROM products WHERE id = $1`, [productId]);
      if ((exists.rowCount ?? 0) === 0) return { error: 'not_found' as const };

      const beforeRes = await c.query(
        `SELECT fields, enabled FROM product_marketplace_fields
         WHERE product_id = $1 AND marketplace = $2`,
        [productId, marketplace],
      );
      const before = beforeRes.rows[0]
        ? { fields: beforeRes.rows[0].fields, enabled: beforeRes.rows[0].enabled }
        : null;

      const r = await c.query(
        `INSERT INTO product_marketplace_fields (product_id, marketplace, fields, enabled, workspace_id)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (product_id, marketplace)
         DO UPDATE SET fields = EXCLUDED.fields, enabled = EXCLUDED.enabled
         RETURNING marketplace, fields, enabled, last_synced`,
        [productId, marketplace, JSON.stringify(input.fields), input.enabled, actor.workspaceId],
      );
      const row = r.rows[0];

      await recordAudit(
        {
          realActorId: actor.realActorId,
          onBehalfOfId: actor.onBehalfOfId ?? null,
          impersonationReason: actor.impersonationReason,
          workspaceId: actor.workspaceId,
          action: 'product.overlay_update',
          resourceType: 'product',
          resourceId: productId,
          metadata: { marketplace },
          before: before ?? null,
          after: { fields: row.fields, enabled: row.enabled },
        },
        c,
      );

      return {
        marketplace: row.marketplace as Marketplace,
        fields: row.fields,
        enabled: row.enabled,
        lastSynced: row.last_synced,
      };
    },
  );
}

export type StockView = {
  lowStock: ProductRow[];
  deadStock: ProductRow[];
  fastMovers: ProductRow[];
};

export async function stockViews(actor: ActorContext): Promise<StockView> {
  if (!actor.workspaceId) throw new Error('workspaceId required');
  return withTenantContext(
    { userId: actor.realActorId, workspaceId: actor.workspaceId },
    async (c) => {
      const wsRes = await c.query(
        `SELECT low_stock_default, dead_stock_days_default FROM workspaces WHERE id = $1`,
        [actor.workspaceId],
      );
      const lowDefault = wsRes.rows[0]?.low_stock_default ?? 5;
      const deadDefault = wsRes.rows[0]?.dead_stock_days_default ?? 60;

      const lowRes = await c.query(
        `SELECT * FROM products
         WHERE status = 'active'
           AND stock_count <= COALESCE(low_stock_threshold, $1)
         ORDER BY stock_count ASC
         LIMIT 20`,
        [lowDefault],
      );

      const deadRes = await c.query(
        `SELECT p.* FROM products p
         WHERE p.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM stock_movements m
             WHERE m.product_id = p.id
               AND m.delta < 0
               AND m.occurred_at > now() - (COALESCE(p.dead_stock_days, $1) || ' days')::interval
           )
           AND p.stock_count > 0
         ORDER BY p.updated_at ASC
         LIMIT 20`,
        [deadDefault],
      );

      const fastRes = await c.query(
        `SELECT p.*,
                (SELECT COALESCE(SUM(ABS(m.delta)), 0)
                 FROM stock_movements m
                 WHERE m.product_id = p.id
                   AND m.delta < 0
                   AND m.occurred_at > now() - interval '30 days') AS velocity
         FROM products p
         WHERE p.status = 'active'
         ORDER BY velocity DESC
         LIMIT 10`,
      );

      return {
        lowStock: lowRes.rows.map(rowToProduct),
        deadStock: deadRes.rows.map(rowToProduct),
        fastMovers: fastRes.rows.map(rowToProduct),
      };
    },
  );
}

function validateCore(input: ProductCore): string | null {
  if (!input.sku || input.sku.trim().length === 0) return 'sku_required';
  if (input.sku.length > 100) return 'sku_too_long';
  if (!input.name || input.name.trim().length === 0) return 'name_required';
  if (input.name.length > 500) return 'name_too_long';
  if (typeof input.price !== 'number' || isNaN(input.price) || input.price < 0) {
    return 'invalid_price';
  }
  if (input.cost != null && (typeof input.cost !== 'number' || input.cost < 0)) {
    return 'invalid_cost';
  }
  if (input.gstRate != null && (input.gstRate < 0 || input.gstRate > 99.99)) {
    return 'invalid_gst_rate';
  }
  if (input.weightG != null && input.weightG < 0) return 'invalid_weight';
  if (input.lowStockThreshold != null && input.lowStockThreshold < 0) {
    return 'invalid_low_stock_threshold';
  }
  if (input.deadStockDays != null && input.deadStockDays < 0) {
    return 'invalid_dead_stock_days';
  }
  return null;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function rowToProduct(row: Record<string, any>): ProductRow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sku: row.sku,
    name: row.name,
    description: row.description ?? undefined,
    productType: row.product_type,
    categoryId: row.category_id ?? undefined,
    subCategoryId: row.sub_category_id ?? undefined,
    primaryImageId: row.primary_image_id ?? undefined,
    extraImageIds: row.extra_image_ids ?? [],
    price: Number(row.price),
    currency: row.currency,
    cost: row.cost == null ? undefined : Number(row.cost),
    stockCount: row.stock_count,
    stockUnit: row.stock_unit,
    weightG: row.weight_g ?? undefined,
    dimLMm: row.dim_l_mm ?? undefined,
    dimWMm: row.dim_w_mm ?? undefined,
    dimHMm: row.dim_h_mm ?? undefined,
    barcode: row.barcode ?? undefined,
    hsnCode: row.hsn_code ?? undefined,
    gstRate: row.gst_rate == null ? undefined : Number(row.gst_rate),
    foodFields: row.food_fields ?? undefined,
    tags: row.tags ?? [],
    lowStockThreshold: row.low_stock_threshold ?? undefined,
    deadStockDays: row.dead_stock_days ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by ?? null,
  };
}

function serializeForDiff(p: ProductRow): Record<string, unknown> {
  return {
    sku: p.sku,
    name: p.name,
    description: p.description,
    product_type: p.productType,
    category_id: p.categoryId,
    sub_category_id: p.subCategoryId,
    price: p.price,
    currency: p.currency,
    cost: p.cost,
    stock_unit: p.stockUnit,
    weight_g: p.weightG,
    dim_l_mm: p.dimLMm,
    dim_w_mm: p.dimWMm,
    dim_h_mm: p.dimHMm,
    barcode: p.barcode,
    hsn_code: p.hsnCode,
    gst_rate: p.gstRate,
    tags: p.tags,
    low_stock_threshold: p.lowStockThreshold,
    dead_stock_days: p.deadStockDays,
    status: p.status,
  };
}
