// Manufacturing test helpers — built on the POS + inventory helpers. Each seed
// mints a fresh Client + L1 Owner and enables products+pos+inventory, then adds
// the 'manufacturing' Product. No teardown (shared dev DB) — randomize literals.
import { neon } from '@neondatabase/serverless';
import { seedClientWithProductsEnabled, type PosTestCtx } from '../pos/_helpers';
import { enableInventory, seedStock } from '../inventory/_helpers';

const sql = neon(process.env.DATABASE_URL!);

export async function enableManufacturing(ctx: PosTestCtx): Promise<void> {
  await sql`
    INSERT INTO public.client_enabled_products (client_id, product_key, enabled_by_admin)
    VALUES (${ctx.clientId}, 'manufacturing', ${ctx.adminId})
    ON CONFLICT (client_id, product_key) DO NOTHING
  `;
}

// Fresh client with products+pos+inventory+manufacturing enabled, L1 Owner session.
export async function seedManufacturingClient(): Promise<PosTestCtx> {
  const ctx = await seedClientWithProductsEnabled();
  await enableInventory(ctx);
  await enableManufacturing(ctx);
  return ctx;
}

export { seedStock };

// Insert a BOM + its components directly (bypassing the API), returns bom id.
export async function seedBom(
  ctx: PosTestCtx,
  outputProductId: string,
  components: ReadonlyArray<{ productId: string; qty: number }>,
  name = `BOM-${Math.random().toString(36).slice(2, 8)}`,
): Promise<string> {
  const bomRows = (await sql`
    INSERT INTO public.boms (client_id, output_product_id, name)
    VALUES (${ctx.clientId}, ${outputProductId}, ${name})
    RETURNING id
  `) as Array<{ id: string }>;
  const bomId = bomRows[0]!.id;
  for (const c of components) {
    await sql`
      INSERT INTO public.bom_components (bom_id, component_product_id, qty)
      VALUES (${bomId}, ${c.productId}, ${c.qty})
    `;
  }
  return bomId;
}

export async function seedOrder(
  ctx: PosTestCtx,
  bomId: string,
  qty: number,
  status = 'planned',
): Promise<string> {
  const rows = (await sql`
    INSERT INTO public.production_orders (client_id, bom_id, qty, status)
    VALUES (${ctx.clientId}, ${bomId}, ${qty}, ${status}::production_order_status)
    RETURNING id
  `) as Array<{ id: string }>;
  return rows[0]!.id;
}

export async function readOrderStatus(id: string): Promise<string | null> {
  const rows = (await sql`SELECT status FROM public.production_orders WHERE id = ${id} LIMIT 1`) as Array<{ status: string }>;
  return rows[0]?.status ?? null;
}
