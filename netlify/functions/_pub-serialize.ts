// Whitelisted public view of a sale (+ lines) for the storefront receipt.
// Shared by pub-sale-create and pub-sale-detail. Internal columns — bucket_id,
// created_by_user_node, source, payment_method, payment_ref, audit — are
// deliberately NOT in this shape; the customer never sees them. See spec §5.3.

export interface SaleRow {
  id: string;
  order_no: number | string;
  status: string;
  channel: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  subtotal_cents: number | string;
  discount_cents: number | string;
  tax_cents: number | string;
  total_cents: number | string;
  created_at: string;
  paid_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
}

export interface SaleLineRow {
  product_name_snap: string;
  unit_price_cents: number | string;
  qty: number | string;
  line_total_cents: number | string;
  position: number | string;
}

export function serializePublicSale(sale: SaleRow, lines: SaleLineRow[]) {
  return {
    id: sale.id,
    orderNo: Number(sale.order_no),
    status: sale.status,
    channel: sale.channel,
    customer: {
      name: sale.customer_name,
      phone: sale.customer_phone,
      email: sale.customer_email,
    },
    subtotalCents: Number(sale.subtotal_cents),
    discountCents: Number(sale.discount_cents),
    taxCents: Number(sale.tax_cents),
    totalCents: Number(sale.total_cents),
    lines: lines.map((l) => ({
      productNameSnap: l.product_name_snap,
      unitPriceCents: Number(l.unit_price_cents),
      qty: Number(l.qty),
      lineTotalCents: Number(l.line_total_cents),
      position: Number(l.position),
    })),
    timeline: {
      placedAt: sale.created_at,
      paidAt: sale.paid_at,
      fulfilledAt: sale.fulfilled_at,
      cancelledAt: sale.cancelled_at,
      refundedAt: sale.refunded_at,
    },
  };
}
