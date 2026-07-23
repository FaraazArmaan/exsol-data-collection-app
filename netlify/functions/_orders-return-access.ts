import { createHash, randomBytes } from 'node:crypto';
import { db } from './_shared/db';
import type { OrdersAuthCtx } from './_orders-authz';

const TOKEN_BYTES = 32;
const TOKEN_TTL_DAYS = 30;

export type ReturnAccessGrant = {
  id: string;
  clientId: string;
  saleId: string;
  expiresAt: string;
};

export function hashReturnAccessToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function issueReturnAccessToken(
  ctx: OrdersAuthCtx,
  saleId: string,
): Promise<{ token: string; expiresAt: string } | null> {
  const sql = db();
  const sale = await sql`
    SELECT id
    FROM public.sales
    WHERE id=${saleId}::uuid AND bucket_id=${ctx.clientId}::uuid AND status='fulfilled'
    LIMIT 1
  `;
  if (!sale[0]) return null;

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await sql.transaction([
    sql`
      UPDATE public.orders_return_access_tokens
      SET revoked_at=now(), revoked_by=${ctx.userNodeId}::uuid
      WHERE sale_id=${saleId}::uuid AND revoked_at IS NULL
    `,
    sql`
      INSERT INTO public.orders_return_access_tokens (client_id,sale_id,token_hash,expires_at,issued_by)
      VALUES (${ctx.clientId}::uuid,${saleId}::uuid,${hashReturnAccessToken(token)},${expiresAt}::timestamptz,${ctx.userNodeId}::uuid)
    `,
  ]);
  return { token, expiresAt };
}

export async function revokeReturnAccessToken(
  ctx: OrdersAuthCtx,
  saleId: string,
): Promise<boolean> {
  const sql = db();
  const rows = await sql`
    UPDATE public.orders_return_access_tokens t
    SET revoked_at=now(), revoked_by=${ctx.userNodeId}::uuid
    FROM public.sales s
    WHERE t.sale_id=${saleId}::uuid
      AND t.sale_id=s.id
      AND s.bucket_id=${ctx.clientId}::uuid
      AND t.revoked_at IS NULL
    RETURNING t.id
  `;
  return Boolean(rows[0]);
}

export async function resolveReturnAccessToken(token: string): Promise<ReturnAccessGrant | null> {
  if (!token || token.length > 256) return null;
  const sql = db();
  const rows = (await sql`
    SELECT id, client_id, sale_id, expires_at
    FROM public.orders_return_access_tokens
    WHERE token_hash=${hashReturnAccessToken(token)}
      AND revoked_at IS NULL
      AND expires_at > now()
    LIMIT 1
  `) as Array<{ id: string; client_id: string; sale_id: string; expires_at: string }>;
  const row = rows[0];
  return row
    ? { id: row.id, clientId: row.client_id, saleId: row.sale_id, expiresAt: row.expires_at }
    : null;
}
