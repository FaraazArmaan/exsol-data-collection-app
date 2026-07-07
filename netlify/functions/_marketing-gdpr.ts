import type { NeonQueryFunction } from '@neondatabase/serverless';

type Sql = NeonQueryFunction<false, false>;

export interface ExportBundle {
  email: string;
  generated_at: string;
  crm_customers: unknown[];
  crm_notes: unknown[];
  sales: unknown[];
  bookings: unknown[];
  campaign_sends: unknown[];
  consent_log: unknown[];
}

/**
 * Gather every row referencing an email across the tenant's data (case-
 * insensitive). crm_notes are pulled via their customer, since notes carry no
 * email of their own.
 */
export async function exportCustomerData(sql: Sql, clientId: string, email: string): Promise<ExportBundle> {
  const e = email.toLowerCase();
  const [crm, notes, sales, bookings, sends, consent] = await Promise.all([
    sql`SELECT * FROM public.crm_customers WHERE client_id = ${clientId}::uuid AND lower(email) = ${e}`,
    sql`SELECT n.* FROM public.crm_notes n JOIN public.crm_customers c ON c.id = n.customer_id
        WHERE c.client_id = ${clientId}::uuid AND lower(c.email) = ${e}`,
    sql`SELECT * FROM public.sales WHERE bucket_id = ${clientId}::uuid AND lower(customer_email) = ${e}`,
    sql`SELECT * FROM public.bookings WHERE bucket_id = ${clientId}::uuid AND lower(customer_email) = ${e}`,
    sql`SELECT * FROM public.campaign_sends WHERE client_id = ${clientId}::uuid AND lower(recipient_email) = ${e}`,
    sql`SELECT * FROM public.marketing_consent_log WHERE client_id = ${clientId}::uuid AND lower(email) = ${e} ORDER BY created_at DESC`,
  ]);
  return {
    email,
    generated_at: new Date().toISOString(),
    crm_customers: crm as unknown[],
    crm_notes: notes as unknown[],
    sales: sales as unknown[],
    bookings: bookings as unknown[],
    campaign_sends: sends as unknown[],
    consent_log: consent as unknown[],
  };
}

export interface ErasureResult {
  crm_customers: number;
  crm_notes: number;
  sales: number;
  bookings: number;
  campaign_sends: number;
}

/**
 * Anonymize a person's PII across the tenant. Financial rows (sales) keep the
 * row but strip PII to placeholders ('[erased]') because DB CHECKs forbid empty
 * name/phone; bookings/sends/crm null their PII. Returns affected-row counts.
 * consent_log is intentionally retained as proof of the erasure request.
 */
export async function eraseCustomerData(sql: Sql, clientId: string, email: string): Promise<ErasureResult> {
  const e = email.toLowerCase();
  const count = (rows: unknown) => (rows as unknown[]).length;

  // crm_notes first (needs the customer email link before crm is anonymized).
  const notes = await sql`
    UPDATE public.crm_notes SET body = '[erased]', updated_at = now()
    WHERE customer_id IN (SELECT id FROM public.crm_customers WHERE client_id = ${clientId}::uuid AND lower(email) = ${e})
    RETURNING id`;
  const crm = await sql`
    UPDATE public.crm_customers
    SET display_name = '[erased]', email = NULL, phone = NULL, updated_at = now()
    WHERE client_id = ${clientId}::uuid AND lower(email) = ${e}
    RETURNING id`;
  const sales = await sql`
    UPDATE public.sales
    SET customer_name = '[erased]', customer_phone = '[erased]', customer_email = NULL
    WHERE bucket_id = ${clientId}::uuid AND lower(customer_email) = ${e}
    RETURNING id`;
  const bookings = await sql`
    UPDATE public.bookings
    SET customer_name = '[erased]', customer_phone = NULL, customer_email = NULL, updated_at = now()
    WHERE bucket_id = ${clientId}::uuid AND lower(customer_email) = ${e}
    RETURNING id`;
  const sends = await sql`
    UPDATE public.campaign_sends SET recipient_email = NULL, recipient_phone = NULL
    WHERE client_id = ${clientId}::uuid AND lower(recipient_email) = ${e}
    RETURNING id`;

  return {
    crm_customers: count(crm),
    crm_notes: count(notes),
    sales: count(sales),
    bookings: count(bookings),
    campaign_sends: count(sends),
  };
}
