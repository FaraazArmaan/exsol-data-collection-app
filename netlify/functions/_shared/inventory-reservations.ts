// Reservation lifecycle for Inventory-tracked sales. Product Manager owns the
// catalogue identity; Inventory owns the on-hand/reserved quantities here.
import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

type Reservation = {
  id: string;
  product_id: string;
  variant_id: string | null;
  qty: number;
  qty_consumed: number;
};

async function inventoryTrackingEnabled(sql: Sql, clientId: string): Promise<boolean> {
  const rows = (await sql`
    SELECT inventory_tracking_enabled FROM public.clients
    WHERE id = ${clientId}::uuid LIMIT 1
  `) as Array<{ inventory_tracking_enabled: boolean }>;
  return Boolean(rows[0]?.inventory_tracking_enabled);
}

// A stock row means this catalogue item is inventory-tracked. Services and
// physical products not yet enrolled in Inventory deliberately have no row and
// remain sellable; a tracked row must have enough unreserved stock.
export async function reserveSaleInventory(sql: Sql, clientId: string, saleId: string): Promise<boolean> {
  if (!(await inventoryTrackingEnabled(sql, clientId))) return true;

  const lines = (await sql`
    SELECT id, product_id, variant_id, qty FROM public.sale_lines
    WHERE sale_id = ${saleId}::uuid ORDER BY position
  `) as Array<{ id: string; product_id: string; variant_id: string | null; qty: number }>;
  const reserved: Reservation[] = [];

  for (const line of lines) {
    // The conditional update is the concurrency guard: two checkouts cannot
    // both reserve the last available unit.
    const created = (await sql`
      WITH held_stock AS (
        UPDATE public.inventory_stock
        SET qty_reserved = qty_reserved + ${line.qty}::int, updated_at = now()
        WHERE client_id = ${clientId}::uuid
          AND product_id = ${line.product_id}::uuid
          AND variant_id IS NOT DISTINCT FROM ${line.variant_id}::uuid
          AND qty_on_hand - qty_reserved >= ${line.qty}::int
        RETURNING product_id
      )
      INSERT INTO public.inventory_reservations
        (client_id, sale_id, sale_line_id, product_id, variant_id, qty)
      SELECT ${clientId}::uuid, ${saleId}::uuid, ${line.id}::uuid,
             ${line.product_id}::uuid, ${line.variant_id}::uuid, ${line.qty}::int
      FROM held_stock
      RETURNING id, product_id, variant_id, qty, 0 AS qty_consumed
    `) as Reservation[];
    if (created[0]) {
      reserved.push(created[0]);
      continue;
    }

    const tracked = (await sql`
      SELECT 1 FROM public.inventory_stock
      WHERE client_id = ${clientId}::uuid
        AND product_id = ${line.product_id}::uuid
        AND variant_id IS NOT DISTINCT FROM ${line.variant_id}::uuid
      LIMIT 1
    `) as Array<{ '?column?': number }>;
    if (tracked[0]) {
      await releaseReservations(sql, clientId, reserved);
      return false;
    }
  }
  return true;
}

async function releaseReservations(sql: Sql, clientId: string, reservations: Reservation[]): Promise<boolean> {
  for (const reservation of reservations) {
    const released = (await sql`
      WITH released_stock AS (
        UPDATE public.inventory_stock AS stock
        SET qty_reserved = stock.qty_reserved - (reservation.qty - reservation.qty_consumed), updated_at = now()
        FROM public.inventory_reservations AS reservation
        WHERE reservation.id = ${reservation.id}::uuid
          AND reservation.status = 'reserved'
          AND stock.client_id = ${clientId}::uuid
          AND stock.product_id = reservation.product_id
          AND stock.variant_id IS NOT DISTINCT FROM reservation.variant_id
        RETURNING reservation.id
      )
      UPDATE public.inventory_reservations AS reservation
      SET status = 'released', released_at = now()
      FROM released_stock
      WHERE reservation.id = released_stock.id
      RETURNING reservation.id
    `) as Array<{ id: string }>;
    if (!released[0]) return false;
  }
  return true;
}

export async function releaseSaleInventory(sql: Sql, clientId: string, saleId: string): Promise<boolean> {
  const reservations = (await sql`
    SELECT id, product_id, variant_id, qty, qty_consumed FROM public.inventory_reservations
    WHERE client_id = ${clientId}::uuid AND sale_id = ${saleId}::uuid AND status = 'reserved'
  `) as Reservation[];
  return releaseReservations(sql, clientId, reservations);
}

export async function consumeSaleInventory(
  sql: Sql,
  clientId: string,
  saleId: string,
  userNodeId: string | null,
): Promise<boolean> {
  const reservations = (await sql`
    SELECT id, product_id, variant_id, qty, qty_consumed FROM public.inventory_reservations
    WHERE client_id = ${clientId}::uuid AND sale_id = ${saleId}::uuid AND status = 'reserved'
  `) as Reservation[];

  // A reservation remains a liability even if the tenant later turns Inventory
  // tracking off. Consume it first; only reservation-free legacy sales consult
  // the current feature flag.
  if (reservations.length > 0) {
    return consumeReservations(sql, clientId, saleId, userNodeId, reservations);
  }
  if (!(await inventoryTrackingEnabled(sql, clientId))) return true;

  // Sales created before reservations shipped have no rows to consume. Keep
  // their original fulfillment behavior so an in-flight legacy order cannot
  // silently skip its Inventory movement after this rollout.
  const lines = (await sql`
    SELECT product_id, variant_id, qty FROM public.sale_lines WHERE sale_id = ${saleId}::uuid
  `) as Array<{ product_id: string; variant_id: string | null; qty: number }>;
  for (const line of lines) {
    const moved = (await sql`
      UPDATE public.inventory_stock
      SET qty_on_hand = GREATEST(0, qty_on_hand - ${line.qty}::int), updated_at = now()
      WHERE client_id = ${clientId}::uuid
        AND product_id = ${line.product_id}::uuid
        AND variant_id IS NOT DISTINCT FROM ${line.variant_id}::uuid
      RETURNING product_id, variant_id
    `) as Array<{ product_id: string; variant_id: string | null }>;
    if (moved[0]) {
      await sql`
        INSERT INTO public.stock_movements (client_id, product_id, variant_id, qty_delta, type, ref, created_by)
        VALUES (${clientId}::uuid, ${line.product_id}::uuid, ${line.variant_id}::uuid, ${-line.qty}::int, 'sale', ${`sale:${saleId}`}, ${userNodeId}::uuid)
      `;
    }
  }
  return true;
}

async function consumeReservations(
  sql: Sql,
  clientId: string,
  saleId: string,
  userNodeId: string | null,
  reservations: Reservation[],
): Promise<boolean> {
  for (const reservation of reservations) {
    const moved = (await sql`
      WITH consumed_stock AS (
        UPDATE public.inventory_stock AS stock
        SET qty_on_hand = stock.qty_on_hand - (reservation.qty - reservation.qty_consumed),
            qty_reserved = stock.qty_reserved - (reservation.qty - reservation.qty_consumed),
            updated_at = now()
        FROM public.inventory_reservations AS reservation
        WHERE reservation.id = ${reservation.id}::uuid
          AND reservation.status = 'reserved'
          AND stock.client_id = ${clientId}::uuid
          AND stock.product_id = reservation.product_id
          AND stock.variant_id IS NOT DISTINCT FROM reservation.variant_id
          AND stock.qty_on_hand >= reservation.qty - reservation.qty_consumed
        RETURNING reservation.id, reservation.product_id, reservation.variant_id, reservation.qty - reservation.qty_consumed AS qty
      ), consumed_reservation AS (
        UPDATE public.inventory_reservations AS reservation
        SET qty_consumed = reservation.qty, status = 'consumed', consumed_at = now()
        FROM consumed_stock
        WHERE reservation.id = consumed_stock.id
        RETURNING consumed_stock.product_id, consumed_stock.variant_id, consumed_stock.qty
      )
      INSERT INTO public.stock_movements (client_id, product_id, variant_id, qty_delta, type, ref, created_by)
      SELECT ${clientId}::uuid, consumed_reservation.product_id, consumed_reservation.variant_id,
             -consumed_reservation.qty, 'sale', ${`sale:${saleId}`}, ${userNodeId}::uuid
      FROM consumed_reservation
      RETURNING id
    `) as Array<{ id: string }>;
    if (!moved[0]) return false;
  }
  return true;
}
