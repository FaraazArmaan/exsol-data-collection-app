import { z } from 'zod';
import { jsonError, jsonOk } from './_shared/http';
import { db } from './_shared/db';
import { logAudit } from './_shared/audit';
import { rejectCrossSiteMutation } from './_shared/csrf';
import { requirePayments } from './_payments-authz';
import { encryptPaymentSecret, PaymentsEncryptionUnavailable } from './_payments-secrets';

export const config = { path: '/api/payments/provider-connection' };

const Secret = z.string().trim().min(8).max(512).nullable();
const PatchBody = z.object({
  enabled: z.boolean().optional(),
  key_id: z.string().trim().regex(/^rzp_test_[A-Za-z0-9]+$/, 'invalid_test_key_id').max(128).nullable().optional(),
  api_secret: Secret.optional(),
  webhook_secret: Secret.optional(),
}).strict();

interface ConnectionRow {
  id: string;
  key_id: string | null;
  api_secret_enc: string | null;
  webhook_secret_enc: string | null;
  enabled: boolean;
  updated_at: string;
}

function summary(row?: ConnectionRow) {
  return {
    provider: 'razorpay' as const,
    mode: 'test' as const,
    enabled: row?.enabled ?? false,
    configured: !!(row?.key_id && row.api_secret_enc && row.webhook_secret_enc),
    key_id_configured: !!row?.key_id,
    api_secret_configured: !!row?.api_secret_enc,
    webhook_secret_configured: !!row?.webhook_secret_enc,
    updated_at: row?.updated_at ?? null,
  };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'PATCH') return jsonError(405, 'method_not_allowed');
  if (req.method === 'PATCH') {
    const csrf = rejectCrossSiteMutation(req);
    if (csrf) return csrf;
  }

  const auth = await requirePayments(req, [req.method === 'GET' ? 'payments.products.view' : 'payments.products.edit']);
  if (!auth.ok) return auth.res;
  const sql = db();
  const existing = (await sql`
    SELECT id, key_id, api_secret_enc, webhook_secret_enc, enabled, updated_at
    FROM public.payment_provider_connections
    WHERE client_id = ${auth.ctx.clientId}::uuid AND provider = 'razorpay' AND mode = 'test'
    LIMIT 1
  `) as ConnectionRow[];
  if (req.method === 'GET') return jsonOk(summary(existing[0]));

  const parsed = PatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'validation_failed');
  const body = parsed.data;
  const has = (key: keyof typeof body) => body[key] !== undefined;
  if (!Object.keys(body).length) return jsonOk(summary(existing[0]));

  let apiSecretEnc = existing[0]?.api_secret_enc ?? null;
  let webhookSecretEnc = existing[0]?.webhook_secret_enc ?? null;
  try {
    if (body.api_secret !== undefined) apiSecretEnc = body.api_secret === null ? null : encryptPaymentSecret(body.api_secret);
    if (body.webhook_secret !== undefined) webhookSecretEnc = body.webhook_secret === null ? null : encryptPaymentSecret(body.webhook_secret);
  } catch (error) {
    if (error instanceof PaymentsEncryptionUnavailable) return jsonError(503, 'payments_encryption_unavailable');
    throw error;
  }
  const keyId = has('key_id') ? body.key_id ?? null : existing[0]?.key_id ?? null;
  const enabled = has('enabled') ? body.enabled! : existing[0]?.enabled ?? false;
  if (enabled && !(keyId && apiSecretEnc && webhookSecretEnc)) return jsonError(400, 'online_requires_credentials');

  const rows = (await sql`
    INSERT INTO public.payment_provider_connections
      (client_id, provider, mode, key_id, api_secret_enc, webhook_secret_enc, enabled)
    VALUES (${auth.ctx.clientId}::uuid, 'razorpay', 'test', ${keyId}, ${apiSecretEnc}, ${webhookSecretEnc}, ${enabled})
    ON CONFLICT (client_id, provider, mode) DO UPDATE SET
      key_id = EXCLUDED.key_id,
      api_secret_enc = EXCLUDED.api_secret_enc,
      webhook_secret_enc = EXCLUDED.webhook_secret_enc,
      enabled = EXCLUDED.enabled
    RETURNING id, key_id, api_secret_enc, webhook_secret_enc, enabled, updated_at
  `) as ConnectionRow[];
  const fieldsChanged = [
    has('enabled') && 'enabled',
    has('key_id') && 'key_id',
    has('api_secret') && 'api_secret',
    has('webhook_secret') && 'webhook_secret',
  ].filter(Boolean) as string[];
  await logAudit(sql, {
    session: {
      kind: 'bucket_user',
      user_node_id: auth.ctx.userNodeId,
      client_id: auth.ctx.clientId,
      level_number: auth.ctx.levelNumber,
    },
    op: 'payments.provider_connection_updated',
    clientId: auth.ctx.clientId,
    targetType: 'payment_provider_connection',
    targetId: rows[0]!.id,
    detail: { provider: 'razorpay', mode: 'test', fields_changed: fieldsChanged, enabled },
  });
  return jsonOk(summary(rows[0]));
}
